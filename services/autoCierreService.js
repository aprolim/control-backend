// services/autoCierreService.js
import Tarjeta from '../models/Tarjeta.js';
import User from '../models/User.js';

// ============================================================
// ALMACENAR TIMEOUTS POR TAREA
// 🔥 La key SIEMPRE es string (tarjetaId.toString()) para
//    evitar el bug de Mongoose con ObjectIds diferentes
// ============================================================
export const timeouts = new Map();

// ============================================================
// FUNCIÓN PARA CALCULAR EFICIENCIA
// ============================================================
const calcularEficiencia = (tiempoEstimado, tiempoReal) => {
  if (!tiempoEstimado || tiempoEstimado <= 0) return 'esperado';
  
  const diferencia = ((tiempoReal - tiempoEstimado) / tiempoEstimado) * 100;
  
  if (diferencia <= -20) return 'mayor_a_esperado';
  if (diferencia <= 20) return 'esperado';
  if (diferencia <= 50) return 'menor_a_esperado';
  return 'critico';
};

// ============================================================
// FUNCIÓN PARA REGISTRAR LOG DE TIEMPOS
// ============================================================
export const registrarLogTiempo = async (tarjetaId, data) => {
  try {
    const tarjeta = await Tarjeta.findById(tarjetaId);
    if (!tarjeta) return null;
    
    const logEntry = {
      timestamp: new Date(),
      tipo: data.tipo,
      tiempoMinutos: data.tiempoMinutos || 0,
      tiempoAnterior: data.tiempoAnterior || 0,
      tiempoReal: data.tiempoReal || 0,
      diferencia: data.diferencia || 0,
      progreso: data.progreso || 0,
      tiempoTrabajado: data.tiempoTrabajado || 0,
      por: data.por || 'Sistema',
      rol: data.rol || 'Sistema',
      motivo: data.motivo || '',
      eficiencia: data.eficiencia || 'esperado',
      tiempoRestante: data.tiempoRestante || 0,
      tecnicoAnterior: data.tecnicoAnterior || '',
      tecnicoNuevo: data.tecnicoNuevo || '',
      alerta: data.alerta || false
    };
    
    tarjeta.logTiempos.push(logEntry);
    await tarjeta.save();
    
    return logEntry;
  } catch (error) {
    console.error('❌ Error registrando log de tiempo:', error);
    return null;
  }
};

// ============================================================
// FUNCIÓN PARA CALCULAR TIEMPO RESTANTE
// ============================================================
const calcularTiempoRestante = (tarjeta) => {
  const tiempoEstimado = tarjeta.tiempoEstimadoEmpleado || 0;
  const tiempoTrabajado = tarjeta.tiempoAcumulado || 0;
  return Math.max(0, tiempoEstimado - tiempoTrabajado);
};

// ============================================================
// FUNCIÓN PARA RECALCULAR TIEMPO ESTIMADO BASADO EN PROGRESO
// ============================================================
export const recalcularTiempoPorProgreso = async (tarjetaId, io, clients, comentarioTecnico = '') => {
  try {
    const tarjeta = await Tarjeta.findById(tarjetaId).populate('asignadoA', 'nombre email rol');
    if (!tarjeta) return null;
    
    let tiempoTotalTrabajado = tarjeta.tiempoAcumulado || 0;
    if (tarjeta.estadoProgreso === 'activa' && tarjeta.fechaUltimaReanudacion) {
      const ahora = new Date();
      const inicio = new Date(tarjeta.fechaUltimaReanudacion);
      const minutosDesdeReanudacion = Math.floor((ahora - inicio) / 1000 / 60);
      tiempoTotalTrabajado += minutosDesdeReanudacion;
    }
    
    const progresoActual = tarjeta.porcentajeCompletado || 0;
    const tiempoEstimadoActual = tarjeta.tiempoEstimadoEmpleado || 0;
    
    if (progresoActual <= 0 || tiempoEstimadoActual <= 0) return null;
    
    const nuevoEstimado = Math.round((tiempoTotalTrabajado / progresoActual) * 100);
    
    if (nuevoEstimado < 1) return null;
    
    const diferencia = nuevoEstimado - tiempoEstimadoActual;
    
    if (Math.abs(diferencia) <= 10) return null;
    
    const eficiencia = calcularEficiencia(tiempoEstimadoActual, tiempoTotalTrabajado);
    const esCritico = eficiencia === 'critico';
    
    console.log(`📊 RECALCULANDO TIEMPO: ${tarjeta.titulo}`);
    console.log(`   Progreso: ${progresoActual}%`);
    console.log(`   Tiempo trabajado: ${tiempoTotalTrabajado} min`);
    console.log(`   Estimado anterior: ${tiempoEstimadoActual} min`);
    console.log(`   Nuevo estimado: ${nuevoEstimado} min`);
    console.log(`   Diferencia: ${diferencia > 0 ? '+' : ''}${diferencia} min`);
    console.log(`   Eficiencia: ${eficiencia}`);
    console.log(`   Comentario técnico: ${comentarioTecnico || '(sin comentario)'}`);
    
    const tiempoAnterior = tiempoEstimadoActual;
    
    tarjeta.tiempoEstimadoEmpleado = nuevoEstimado;
    
    const tiempoRestante = Math.max(0, nuevoEstimado - tiempoTotalTrabajado);
    tarjeta.fechaEstimadaFin = new Date(Date.now() + tiempoRestante * 60 * 1000);
    
    await tarjeta.save();
    
    const motivoFinal = comentarioTecnico.trim() 
      ? comentarioTecnico.trim() 
      : `Progreso ${progresoActual}% en ${tiempoTotalTrabajado} min`;
    
    const logEntry = await registrarLogTiempo(tarjeta._id, {
      tipo: 'recalculado_progreso',
      progreso: progresoActual,
      tiempoTrabajado: tiempoTotalTrabajado,
      tiempoMinutos: nuevoEstimado,
      tiempoAnterior: tiempoAnterior,
      diferencia: diferencia,
      eficiencia: eficiencia,
      tiempoRestante: nuevoEstimado - tiempoTotalTrabajado,
      por: tarjeta.asignadoA?.nombre || 'Sistema',
      rol: tarjeta.asignadoA?.rol || 'Sistema',
      motivo: motivoFinal,
      alerta: esCritico
    });
    
    if (esCritico && io && clients) {
      const supervisores = await User.find({ rol: 'supervisor', activo: true }).select('_id');
      for (const supervisor of supervisores) {
        const socket = clients.get(supervisor._id.toString());
        if (socket) {
          socket.emit('alerta-progreso-critico', {
            tareaId: tarjeta._id,
            titulo: tarjeta.titulo,
            tecnico: tarjeta.asignadoA?.nombre || 'Sin asignar',
            progreso: progresoActual,
            tiempoTrabajado: tiempoTotalTrabajado,
            tiempoEstimadoAnterior: tiempoAnterior,
            tiempoEstimadoNuevo: nuevoEstimado,
            eficiencia: eficiencia,
            motivo: motivoFinal,
            mensaje: `⚠️ La tarea "${tarjeta.titulo}" tiene un progreso crítico: ${progresoActual}% en ${tiempoTotalTrabajado} min (estimado ${nuevoEstimado} min)`
          });
        }
      }
    }
    
    return { nuevoEstimado, diferencia, eficiencia, logEntry };
    
  } catch (error) {
    console.error('❌ Error recalculando tiempo por progreso:', error);
    return null;
  }
};

// ============================================================
// AUTO-FINALIZAR TAREA
// ============================================================
export const autoFinalizarTarea = async (tareaId, io, clients, tiempoRealForzado = null) => {
  // 🔥 CLAVE: convertir a string para consistencia con el Map
  const key = tareaId.toString();
  
  try {
    console.log(`🔥 [AUTO-CIERRE] Evento real para tarea: ${key}`);
    
    const tarjeta = await Tarjeta.findById(key).populate('asignadoA', 'nombre email');
    
    if (!tarjeta) {
      console.log(`❌ Tarea ${key} no encontrada`);
      timeouts.delete(key);
      return;
    }
    
    if (tarjeta.estado !== 'en_progreso') {
      console.log(`⏭️ Tarea ${key} ya no está en progreso (${tarjeta.estado})`);
      timeouts.delete(key);
      return;
    }
    
    if (tarjeta.estadoProgreso !== 'activa') {
      console.log(`⏭️ Tarea ${key} está pausada, cancelando auto-cierre`);
      timeouts.delete(key);
      return;
    }
    
    // ============================================================
    // CALCULAR TIEMPO TOTAL TRABAJADO
    // ============================================================
    let tiempoTotalTrabajado;
    
    if (tiempoRealForzado !== null && tiempoRealForzado !== undefined) {
      tiempoTotalTrabajado = tiempoRealForzado;
      console.log(`   🔒 Usando tiempo CONGELADO: ${tiempoTotalTrabajado} min`);
    } else {
      tiempoTotalTrabajado = tarjeta.tiempoAcumulado || 0;
      if (tarjeta.fechaUltimaReanudacion) {
        const ahora = new Date();
        const inicio = new Date(tarjeta.fechaUltimaReanudacion);
        const minutosDesdeReanudacion = Math.floor((ahora - inicio) / 1000 / 60);
        tiempoTotalTrabajado += minutosDesdeReanudacion;
      }
      console.log(`   📐 Calculando tiempo real desde fechaUltimaReanudacion`);
    }
    
    const tiempoEstimado = tarjeta.tiempoEstimadoEmpleado || 0;
    const diferencia = tiempoTotalTrabajado - tiempoEstimado;
    const eficiencia = calcularEficiencia(tiempoEstimado, tiempoTotalTrabajado);
    
    console.log(`✅ AUTO-FINALIZANDO: ${tarjeta.titulo}`);
    console.log(`   Tiempo estimado: ${tiempoEstimado} min`);
    console.log(`   Tiempo trabajado: ${tiempoTotalTrabajado} min`);
    console.log(`   Diferencia: ${diferencia > 0 ? '+' : ''}${diferencia} min`);
    console.log(`   Eficiencia: ${eficiencia}`);
    
    // Finalizar directamente
    tarjeta.estado = 'finalizada';
    tarjeta.fechaCompletadaEmpleado = new Date();
    tarjeta.fechaFinalizada = new Date();
    tarjeta.estadoProgreso = 'completada';
    tarjeta.porcentajeCompletado = 100;
    tarjeta.tiempoAcumulado = tiempoTotalTrabajado;
    tarjeta.fechaUltimaPausa = null;
    tarjeta.estadoCalificacion = 'pendiente';
    
    const horasReales = Math.floor(tiempoTotalTrabajado / 60);
    const minutosReales = tiempoTotalTrabajado % 60;
    tarjeta.horasTotalesReales = horasReales;
    tarjeta.minutosTotalesReales = minutosReales;
    
    await tarjeta.save();
    
    await registrarLogTiempo(tarjeta._id, {
      tipo: 'tarea_auto_finalizada',
      tiempoMinutos: tiempoEstimado,
      tiempoReal: tiempoTotalTrabajado,
      diferencia: diferencia,
      eficiencia: eficiencia,
      por: 'Sistema (auto-cierre)',
      rol: 'Sistema',
      motivo: `Auto-finalizada por cumplimiento de tiempo (${tiempoTotalTrabajado} min)`
    });
    
    if (io && clients) {
      // Notificar al técnico
      if (tarjeta.asignadoA) {
        const socketEmpleado = clients.get(tarjeta.asignadoA._id.toString());
        if (socketEmpleado) {
          socketEmpleado.emit('tarea-auto-finalizada', {
            tareaId: tarjeta._id,
            titulo: tarjeta.titulo,
            mensaje: `✅ Tarea completada automáticamente (${diferencia > 0 ? diferencia + ' min extra' : 'tiempo cumplido'})`,
            empleadoNombre: tarjeta.asignadoA.nombre,
            tiempoEstimado: tiempoEstimado,
            tiempoReal: tiempoTotalTrabajado,
            eficiencia: eficiencia
          });
          console.log(`   ✅ Socket emitido a técnico: ${tarjeta.asignadoA.nombre}`);
        }
      }
      
      // Notificar al cliente si existe
      if (tarjeta.clienteInfo?.userId) {
        const socketCliente = clients.get(tarjeta.clienteInfo.userId.toString());
        if (socketCliente) {
          socketCliente.emit('tarea-finalizada-por-ti', {
            tareaId: tarjeta._id,
            titulo: tarjeta.titulo,
            mensaje: `✅ Tu tarea "${tarjeta.titulo}" ha sido finalizada. Puedes calificarla cuando quieras.`
          });
        }
      }
      
      // Broadcast general
      io.emit('estado-general-actualizado', {
        tareaId: tarjeta._id,
        titulo: tarjeta.titulo,
        estado: tarjeta.estado,
        porcentaje: 100,
        accion: 'auto-finalizada',
        mensaje: `Tarea "${tarjeta.titulo}" auto-finalizada`
      });
      
      // Notificar a supervisores
      const supervisores = await User.find({ rol: 'supervisor', activo: true }).select('_id');
      supervisores.forEach(sup => {
        const socketSup = clients.get(sup._id.toString());
        if (socketSup) {
          socketSup.emit('kanban-actualizar', {
            tareaId: tarjeta._id,
            tarea: tarjeta,
            accion: 'auto-finalizada',
            mensaje: `✅ Tarea auto-finalizada: ${tarjeta.titulo}`
          });
        }
      });
    }
    
    timeouts.delete(key);
    console.log(`✅ [AUTO-CIERRE] Tarea ${key} finalizada exitosamente`);
    
    return { success: true, tarjeta };
    
  } catch (error) {
    console.error('❌ [AUTO-CIERRE] Error:', error);
    timeouts.delete(key);
    return { success: false, error: error.message };
  }
};

// ============================================================
// PROGRAMAR AUTO-FINALIZACIÓN
// 🔥 FIX: usar tarjetaId.toString() como key del Map para
//    evitar que Mongoose ObjectIds diferentes no se encuentren
// ============================================================
export const programarAutoFinalizacion = (tarjetaId, tiempoMinutos, io, clients) => {
  // 🔥 CLAVE: convertir a string
  const key = tarjetaId.toString();
  
  // Cancelar timer previo si existe
  if (timeouts.has(key)) {
    clearTimeout(timeouts.get(key));
    timeouts.delete(key);
    console.log(`⏹️ [Auto-cierre] Timer previo cancelado para tarea ${key}`);
  }
  
  if (!tiempoMinutos || tiempoMinutos <= 0) {
    console.log(`⏭️ [Auto-cierre] No se programa (tiempo=${tiempoMinutos}) para tarea ${key}`);
    return;
  }
  
  // Margen de 30 segundos
  const tiempoMs = (tiempoMinutos * 60 * 1000) + (30 * 1000);
  
  console.log(`⏰ [Auto-cierre] Programando para tarea ${key} en ${tiempoMinutos} min (${(tiempoMs/60000).toFixed(1)} min reales)`);
  
  const timeoutId = setTimeout(async () => {
    console.log(`🔥 [Auto-cierre] Timer disparado para tarea ${key}`);
    await autoFinalizarTarea(key, io, clients, tiempoMinutos);
  }, tiempoMs);
  
  timeouts.set(key, timeoutId);
  console.log(`   📊 Total timers activos: ${timeouts.size}`);
};

// ============================================================
// CANCELAR AUTO-FINALIZACIÓN
// 🔥 FIX: usar tarjetaId.toString() como key del Map
// ============================================================
export const cancelarAutoFinalizacion = (tarjetaId) => {
  // 🔥 CLAVE: convertir a string
  const key = tarjetaId.toString();
  
  if (timeouts.has(key)) {
    clearTimeout(timeouts.get(key));
    timeouts.delete(key);
    console.log(`⏹️ [Auto-cierre] Cancelado timer para tarea ${key}`);
    console.log(`   📊 Total timers activos: ${timeouts.size}`);
    return true;
  }
  
  console.log(`⚠️ [Auto-cierre] No se encontró timer para tarea ${key}`);
  return false;
};

// ============================================================
// VERIFICAR TAREAS ACTIVAS AL INICIAR
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
      let tiempoTotalTrabajado = tarjeta.tiempoAcumulado || 0;
      
      if (tarjeta.fechaUltimaReanudacion) {
        const ahora = new Date();
        const inicio = new Date(tarjeta.fechaUltimaReanudacion);
        const minutosDesdeReanudacion = Math.floor((ahora - inicio) / 1000 / 60);
        tiempoTotalTrabajado += minutosDesdeReanudacion;
      }
      
      const tiempoRestante = Math.max(0, tarjeta.tiempoEstimadoEmpleado - tiempoTotalTrabajado);
      
      if (tiempoRestante <= 0) {
        console.log(`⚠️ Tarea ${tarjeta.titulo} ya excedió el tiempo, finalizando...`);
        await autoFinalizarTarea(tarjeta._id.toString(), io, clients, tarjeta.tiempoEstimadoEmpleado);
      } else {
        console.log(`⏰ Reprogramando tarea ${tarjeta.titulo}: ${tiempoRestante} min restantes`);
        programarAutoFinalizacion(tarjeta._id.toString(), tiempoRestante, io, clients);
      }
    }
    
    console.log('✅ Verificación completada');
    
  } catch (error) {
    console.error('❌ Error en verificarTareasActivas:', error);
  }
};

// ============================================================
// INICIAR SERVICIO
// ============================================================
export const iniciarAutoCierreService = (io, clients) => {
  console.log('⏰ [SERVICIO] Iniciando auto-cierre con eventos reales...');
  console.log(`   📡 io: ${io ? '✅ Disponible' : '❌ No disponible'}`);
  console.log(`   👥 clients: ${clients ? '✅ Disponible' : '❌ No disponible'}`);
  console.log(`   ⏱️ Usando setTimeout (eventos reales, no polling)`);
  console.log(`   🔒 Tiempo real CONGELADO al programar`);
  console.log(`   🔑 Keys del Map son STRINGS (fix ObjectId)`);
  
  setTimeout(() => {
    verificarTareasActivas(io, clients);
  }, 3000);
  
  console.log('⏰ [SERVICIO] Auto-cierre de tareas activo (basado en eventos)');
};