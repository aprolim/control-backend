// services/autoCierreService.js
import Tarjeta from '../models/Tarjeta.js';
import User from '../models/User.js';

// ============================================================
// ALMACENAR TIMEOUTS POR TAREA (para cancelar si es necesario)
// ============================================================
export const timeouts = new Map();

// ============================================================
// AUTO-FINALIZAR TAREA (EVENTO REAL)
// ============================================================
export const autoFinalizarTarea = async (tareaId, io, clients) => {
  try {
    console.log(`🔥 [AUTO-CIERRE] Evento real para tarea: ${tareaId}`);
    
    const tarjeta = await Tarjeta.findById(tareaId).populate('asignadoA', 'nombre email');
    
    if (!tarjeta) {
      console.log(`❌ Tarea ${tareaId} no encontrada`);
      timeouts.delete(tareaId);
      return;
    }
    
    // Verificar que sigue activa
    if (tarjeta.estado !== 'en_progreso') {
      console.log(`⏭️ Tarea ${tareaId} ya no está en progreso (${tarjeta.estado})`);
      timeouts.delete(tareaId);
      return;
    }
    
    if (tarjeta.estadoProgreso !== 'activa') {
      console.log(`⏭️ Tarea ${tareaId} está pausada, reprogramando...`);
      // Si está pausada, reprogramar con el tiempo restante
      const tiempoRestante = Math.max(0, tarjeta.tiempoEstimadoEmpleado - (tarjeta.tiempoAcumulado || 0));
      if (tiempoRestante > 0) {
        programarAutoFinalizacion(tareaId, tiempoRestante, io, clients);
      }
      return;
    }
    
    // Calcular tiempo real trabajado
    let tiempoTotalTrabajado = tarjeta.tiempoAcumulado || 0;
    if (tarjeta.fechaUltimaReanudacion) {
      const ahora = new Date();
      const inicio = new Date(tarjeta.fechaUltimaReanudacion);
      const minutosDesdeReanudacion = Math.floor((ahora - inicio) / 1000 / 60);
      tiempoTotalTrabajado += minutosDesdeReanudacion;
    }
    
    console.log(`✅ AUTO-FINALIZANDO: ${tarjeta.titulo}`);
    console.log(`   Tiempo estimado: ${tarjeta.tiempoEstimadoEmpleado} min`);
    console.log(`   Tiempo trabajado: ${tiempoTotalTrabajado} min`);
    
    // Actualizar tarjeta
    tarjeta.estado = 'revision_supervisor';
    tarjeta.fechaCompletadaEmpleado = new Date();
    tarjeta.fechaRevisionSupervisor = new Date();
    tarjeta.revisionSupervisor = 'pendiente';
    tarjeta.fechaExpiracionRevisionSupervisor = new Date(Date.now() + 24 * 60 * 60 * 1000);
    tarjeta.estadoProgreso = 'completada';
    tarjeta.porcentajeCompletado = 100;
    tarjeta.tiempoAcumulado = tiempoTotalTrabajado;
    
    await tarjeta.save();
    
    // ============================================================
    // 🔥 NOTIFICACIONES EN TIEMPO REAL VÍA WEBSOCKET
    // ============================================================
    
    if (io && clients) {
      // 1. NOTIFICAR AL TÉCNICO
      if (tarjeta.asignadoA) {
        const socketEmpleado = clients.get(tarjeta.asignadoA._id.toString());
        if (socketEmpleado) {
          socketEmpleado.emit('tarea-auto-finalizada', {
            tareaId: tarjeta._id,
            titulo: tarjeta.titulo,
            mensaje: '✅ Tarea completada automáticamente (tiempo estimado cumplido)',
            empleadoNombre: tarjeta.asignadoA.nombre,
            tiempoEstimado: tarjeta.tiempoEstimadoEmpleado,
            tiempoReal: tiempoTotalTrabajado
          });
          console.log(`   ✅ Socket emitido a técnico: ${tarjeta.asignadoA.nombre}`);
        }
      }
      
      // 2. NOTIFICAR A TODOS LOS SUPERVISORES
      const supervisores = await User.find({ rol: 'supervisor', activo: true }).select('_id nombre');
      for (const supervisor of supervisores) {
        const socket = clients.get(supervisor._id.toString());
        if (socket) {
          socket.emit('tarea-lista-para-revision', {
            tareaId: tarjeta._id,
            titulo: tarjeta.titulo,
            empleadoId: tarjeta.asignadoA?._id,
            empleadoNombre: tarjeta.asignadoA?.nombre || 'Sin asignar',
            tiempoEstimado: tarjeta.tiempoEstimadoEmpleado,
            tiempoReal: tiempoTotalTrabajado,
            mensaje: `📋 Tarea "${tarjeta.titulo}" lista para revisión (auto-finalizada)`
          });
          console.log(`   ✅ Socket emitido a supervisor: ${supervisor.nombre}`);
        }
      }
      
      // 3. NOTIFICAR AL CLIENTE (si tiene cuenta)
      if (tarjeta.clienteInfo?.userId) {
        const socketCliente = clients.get(tarjeta.clienteInfo.userId.toString());
        if (socketCliente) {
          socketCliente.emit('tarea-por-revisar', {
            tareaId: tarjeta._id,
            titulo: tarjeta.titulo,
            mensaje: `📋 Tu solicitud "${tarjeta.titulo}" está lista para revisión`
          });
          console.log(`   ✅ Socket emitido a cliente: ${tarjeta.clienteInfo.userId}`);
        }
      }
      
      // 4. NOTIFICACIÓN GENERAL (a todos los usuarios conectados)
      io.emit('estado-general-actualizado', {
        tareaId: tarjeta._id,
        titulo: tarjeta.titulo,
        estado: tarjeta.estado,
        porcentaje: 100,
        accion: 'auto-finalizada',
        mensaje: `Tarea "${tarjeta.titulo}" auto-finalizada por tiempo cumplido`
      });
      console.log(`   ✅ Socket emitido a todos los usuarios`);
    }
    
    // Limpiar timeout
    timeouts.delete(tareaId);
    console.log(`✅ [AUTO-CIERRE] Tarea ${tareaId} finalizada exitosamente`);
    
    return { success: true, tarjeta };
    
  } catch (error) {
    console.error('❌ [AUTO-CIERRE] Error en autoFinalizarTarea:', error);
    timeouts.delete(tareaId);
    return { success: false, error: error.message };
  }
};

// ============================================================
// PROGRAMAR AUTO-FINALIZACIÓN (SETTIMEOUT REAL)
// ============================================================
export const programarAutoFinalizacion = (tarjetaId, tiempoMinutos, io, clients) => {
  // Cancelar timeout existente
  if (timeouts.has(tarjetaId)) {
    clearTimeout(timeouts.get(tarjetaId));
    timeouts.delete(tarjetaId);
    console.log(`⏹️ Auto-finalización cancelada para tarea ${tarjetaId}`);
  }
  
  // Si el tiempo es 0 o menor, no programar
  if (!tiempoMinutos || tiempoMinutos <= 0) {
    console.log(`⚠️ Tiempo inválido para tarea ${tarjetaId}: ${tiempoMinutos} min`);
    return;
  }
  
  // Convertir a milisegundos y añadir 30 segundos de gracia
  const tiempoMs = (tiempoMinutos * 60 * 1000) + (30 * 1000);
  
  console.log(`⏰ Programando auto-finalización para tarea ${tarjetaId} en ${tiempoMinutos} minutos (${Math.floor(tiempoMs/1000)}s)`);
  
  // Crear nuevo timeout
  const timeoutId = setTimeout(async () => {
    console.log(`🔥 [EVENTO] Timeout disparado para tarea ${tarjetaId}`);
    await autoFinalizarTarea(tarjetaId, io, clients);
  }, tiempoMs);
  
  timeouts.set(tarjetaId, timeoutId);
};

// ============================================================
// CANCELAR AUTO-FINALIZACIÓN
// ============================================================
export const cancelarAutoFinalizacion = (tarjetaId) => {
  if (timeouts.has(tarjetaId)) {
    clearTimeout(timeouts.get(tarjetaId));
    timeouts.delete(tarjetaId);
    console.log(`⏹️ Auto-finalización cancelada para tarea ${tarjetaId}`);
    return true;
  }
  return false;
};

// ============================================================
// VERIFICAR TAREAS HUÉRFANAS (al iniciar el servidor)
// ============================================================
export const verificarTareasActivas = async (io, clients) => {
  try {
    console.log('🔍 Verificando tareas activas existentes...');
    
    const tareasActivas = await Tarjeta.find({
      estado: 'en_progreso',
      estadoProgreso: 'activa',
      tiempoEstimadoEmpleado: { $gt: 0 }
    }).populate('asignadoA', 'nombre email');
    
    console.log(`📊 Encontradas ${tareasActivas.length} tareas activas`);
    
    for (const tarjeta of tareasActivas) {
      // Calcular tiempo trabajado
      let tiempoTotalTrabajado = tarjeta.tiempoAcumulado || 0;
      
      if (tarjeta.fechaUltimaReanudacion) {
        const ahora = new Date();
        const inicio = new Date(tarjeta.fechaUltimaReanudacion);
        const minutosDesdeReanudacion = Math.floor((ahora - inicio) / 1000 / 60);
        tiempoTotalTrabajado += minutosDesdeReanudacion;
      }
      
      const tiempoRestante = Math.max(0, tarjeta.tiempoEstimadoEmpleado - tiempoTotalTrabajado);
      
      // Si ya excedió el tiempo, finalizar inmediatamente
      if (tiempoRestante <= 0) {
        console.log(`⚠️ Tarea ${tarjeta.titulo} ya excedió el tiempo, finalizando...`);
        await autoFinalizarTarea(tarjeta._id, io, clients);
      } else {
        // Reprogramar con el tiempo restante
        console.log(`⏰ Reprogramando tarea ${tarjeta.titulo}: ${tiempoRestante} min restantes`);
        programarAutoFinalizacion(tarjeta._id, tiempoRestante, io, clients);
      }
    }
    
    console.log('✅ Verificación completada');
    
  } catch (error) {
    console.error('❌ Error en verificarTareasActivas:', error);
  }
};

// ============================================================
// INICIAR SERVICIO (sin setInterval)
// ============================================================
export const iniciarAutoCierreService = (io, clients) => {
  console.log('⏰ [SERVICIO] Iniciando auto-cierre con eventos reales...');
  console.log(`   📡 io: ${io ? '✅ Disponible' : '❌ No disponible'}`);
  console.log(`   👥 clients: ${clients ? '✅ Disponible' : '❌ No disponible'}`);
  console.log(`   ⏱️ Usando setTimeout (eventos reales, no polling)`);
  
  // Verificar tareas activas al iniciar
  setTimeout(() => {
    verificarTareasActivas(io, clients);
  }, 3000);
  
  console.log('⏰ [SERVICIO] Auto-cierre de tareas activo (basado en eventos)');
};