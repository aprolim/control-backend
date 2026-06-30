import Tarjeta from '../models/Tarjeta.js';
import User from '../models/User.js';

// Función principal para auto-finalizar tareas expiradas
export const autoFinalizarTareasExpiradas = async (io, clients) => {
  try {
    console.log('🔄 [AUTO-CIERRE] Verificando tareas expiradas...', new Date().toISOString());
    
    // Obtener configuración global del jefe
    const jefe = await User.findOne({ rol: 'jefe', activo: true });
    
    if (!jefe || !jefe.configuracionAutoCierre?.habilitado) {
      console.log('⚠️ [AUTO-CIERRE] Auto-cierre deshabilitado por el jefe');
      return;
    }
    
    const config = jefe.configuracionAutoCierre;
    const excepcionesIds = config.excepcionesEmpleados?.map(id => id.toString()) || [];
    
    const resultados = {
      revisadas: 0,
      finalizadas: 0,
      notificadas: 0
    };
    
    // 1. REVISAR TAREAS EN REVISIÓN DE CLIENTE
    if (config.revisarColumna === 'revision_cliente' || config.revisarColumna === 'ambas') {
      const fechaLimite = new Date();
      fechaLimite.setDate(fechaLimite.getDate() - config.diasMaximosCliente);
      
      const tareasExpiradas = await Tarjeta.find({
        estado: 'revision_cliente',
        estadoCalificacion: 'pendiente',
        createdAt: { $lt: fechaLimite },
        asignadoA: { $nin: excepcionesIds } // Excluir excepciones
      }).populate('asignadoA', 'nombre email');
      
      console.log(`📊 [CLIENTE] Encontradas ${tareasExpiradas.length} tareas expiradas (${config.diasMaximosCliente} días)`);
      
      for (const tarjeta of tareasExpiradas) {
        await procesarTareaExpirada(tarjeta, config, io, clients, 'cliente');
        resultados.finalizadas++;
      }
      resultados.revisadas += tareasExpiradas.length;
    }
    
    // 2. REVISAR TAREAS EN REVISIÓN DE JEFE
    if (config.revisarColumna === 'revision_jefe' || config.revisarColumna === 'ambas') {
      const fechaLimite = new Date();
      fechaLimite.setDate(fechaLimite.getDate() - config.diasMaximosJefe);
      
      const tareasExpiradas = await Tarjeta.find({
        estado: 'revision_jefe',
        revisionJefe: 'pendiente',
        createdAt: { $lt: fechaLimite },
        asignadoA: { $nin: excepcionesIds }
      }).populate('asignadoA', 'nombre email');
      
      console.log(`📊 [JEFE] Encontradas ${tareasExpiradas.length} tareas expiradas (${config.diasMaximosJefe} días)`);
      
      for (const tarjeta of tareasExpiradas) {
        await procesarTareaExpirada(tarjeta, config, io, clients, 'jefe');
        resultados.finalizadas++;
      }
      resultados.revisadas += tareasExpiradas.length;
    }
    
    // 3. ENVIAR NOTIFICACIONES DE ADVERTENCIA (días antes)
    if (config.notificarAntesDias > 0) {
      await enviarNotificacionesAdvertencia(config, io, clients);
      resultados.notificadas = await contarNotificacionesEnviadas();
    }
    
    console.log(`✅ [AUTO-CIERRE] Completado: ${resultados.finalizadas} auto-finalizadas, ${resultados.notificadas} notificaciones`);
    
    return resultados;
    
  } catch (error) {
    console.error('❌ [AUTO-CIERRE] Error:', error);
    return { error: error.message };
  }
};

// Procesar una tarea expirada según la acción configurada
async function procesarTareaExpirada(tarjeta, config, io, clients, tipo) {
  console.log(`⏰ Procesando tarea: ${tarjeta.titulo} (${tipo})`);
  
  let mensaje = '';
  let nuevoEstado = '';
  let calificacionAuto = {};
  
  switch (config.accionAuto) {
    case 'finalizar':
      nuevoEstado = 'finalizada';
      mensaje = `✅ Tarea auto-finalizada por falta de revisión del ${tipo === 'cliente' ? 'cliente' : 'jefe'}`;
      calificacionAuto = {
        puntaje: null,
        comentario: mensaje,
        fecha: new Date(),
        autoFinalizada: true,
        tipo: tipo
      };
      break;
      
    case 'notificar_jefe':
      nuevoEstado = 'revision_jefe';
      mensaje = `⚠️ Tarea requiere atención del jefe (venció revisión de ${tipo})`;
      calificacionAuto = {
        comentario: mensaje,
        fecha: new Date(),
        requiereAtencion: true
      };
      break;
      
    case 'escalar':
      nuevoEstado = 'pendiente';
      mensaje = `🔄 Tarea reabierta por falta de revisión. Se reasignará a otro empleado`;
      calificacionAuto = {
        comentario: mensaje,
        fecha: new Date(),
        reabierta: true
      };
      // Reasignar a nuevo empleado
      tarjeta.asignadoA = null;
      break;
      
    case 'reabrir':
      nuevoEstado = 'en_progreso';
      mensaje = `🔄 Tarea reabierta. El empleado debe continuar trabajando`;
      calificacionAuto = {
        comentario: mensaje,
        fecha: new Date(),
        reabierta: true
      };
      break;
      
    default:
      nuevoEstado = 'finalizada';
      mensaje = `Tarea finalizada automáticamente`;
  }
  
  // Actualizar tarjeta
  tarjeta.estado = nuevoEstado;
  tarjeta.fechaFinalizada = new Date();
  tarjeta.estadoCalificacion = 'expirada';
  tarjeta.calificacion = calificacionAuto;
  
  if (config.accionAuto === 'escalar') {
    tarjeta.asignadoA = null;
  }
  
  await tarjeta.save();
  
  // Notificaciones vía Socket.IO
  if (io && clients) {
    // Notificar al empleado
    if (tarjeta.asignadoA) {
      const socketEmpleado = clients.get(tarjeta.asignadoA._id?.toString());
      if (socketEmpleado) {
        socketEmpleado.emit('tarea-auto-finalizada', {
          tareaId: tarjeta._id,
          titulo: tarjeta.titulo,
          mensaje: mensaje,
          accion: config.accionAuto
        });
      }
    }
    
    // Notificar a todos los jefes
    const jefes = await User.find({ rol: 'jefe', activo: true }).select('_id');
    jefes.forEach(jefe => {
      const socket = clients.get(jefe._id.toString());
      if (socket) {
        socket.emit('tarea-auto-finalizada', {
          tareaId: tarjeta._id,
          titulo: tarjeta.titulo,
          empleado: tarjeta.asignadoA?.nombre,
          mensaje: mensaje,
          accion: config.accionAuto
        });
      }
    });
  }
  
  console.log(`   ✅ Tarea ${tarjeta._id} -> ${nuevoEstado}`);
}

// Enviar notificaciones de advertencia días antes de expirar
async function enviarNotificacionesAdvertencia(config, io, clients) {
  const fechaAdvertencia = new Date();
  fechaAdvertencia.setDate(fechaAdvertencia.getDate() + config.notificarAntesDias);
  
  // Tareas que expiran pronto
  const tareasPorExpirar = await Tarjeta.find({
    estado: 'revision_cliente',
    estadoCalificacion: 'pendiente',
    createdAt: { $lt: fechaAdvertencia }
  }).populate('asignadoA', 'nombre email');
  
  for (const tarjeta of tareasPorExpirar) {
    // Notificar al cliente si tiene socket
    if (tarjeta.clienteInfo?.userId && clients) {
      const socketCliente = clients.get(tarjeta.clienteInfo.userId.toString());
      if (socketCliente) {
        socketCliente.emit('tarea-por-expirar', {
          tareaId: tarjeta._id,
          titulo: tarjeta.titulo,
          diasRestantes: config.notificarAntesDias,
          mensaje: `⚠️ La tarea "${tarjeta.titulo}" expirará en ${config.notificarAntesDias} días si no la revisas`
        });
      }
    }
    
    // Notificar al empleado
    if (tarjeta.asignadoA && clients) {
      const socketEmpleado = clients.get(tarjeta.asignadoA._id.toString());
      if (socketEmpleado) {
        socketEmpleado.emit('tarea-por-expirar', {
          tareaId: tarjeta._id,
          titulo: tarjeta.titulo,
          diasRestantes: config.notificarAntesDias,
          mensaje: `⚠️ La tarea "${tarjeta.titulo}" será auto-finalizada si el cliente no la revisa en ${config.notificarAntesDias} días`
        });
      }
    }
  }
}

async function contarNotificacionesEnviadas() {
  // Implementar si se quiere guardar histórico
  return 0;
}

// Iniciar el servicio programado
export const iniciarAutoCierreService = (io, clients) => {
  // Ejecutar cada hora
  const intervalId = setInterval(async () => {
    await autoFinalizarTareasExpiradas(io, clients);
  }, 60 * 60 * 1000); // Cada hora
  
  // También ejecutar al iniciar
  setTimeout(() => {
    autoFinalizarTareasExpiradas(io, clients);
  }, 5000); // 5 segundos después de iniciar
  
  console.log('⏰ [SERVICIO] Auto-cierre de tareas iniciado (cada hora)');
  
  return intervalId;
};