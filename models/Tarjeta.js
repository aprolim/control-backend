// models/Tarjeta.js
import mongoose from 'mongoose';

const registroHorasSchema = new mongoose.Schema({
  fecha: {
    type: Date,
    default: Date.now
  },
  horasTrabajadas: {
    type: Number,
    required: true
  },
  minutosTrabajados: {
    type: Number,
    default: 0
  },
  porcentajeAvance: {
    type: Number,
    required: true
  },
  comentario: String,
  inicioTrabajo: Date,
  finTrabajo: Date,
  cruzoMedianoche: {
    type: Boolean,
    default: false
  },
  esHoraExtra: {
    type: Boolean,
    default: false
  }
});

const toleranciaSchema = new mongoose.Schema({
  fecha: {
    type: Date,
    default: Date.now
  },
  motivo: String,
  horasExtras: Number,
  minutosExtras: Number,
  aprobadaPor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  estado: {
    type: String,
    enum: ['pendiente', 'aprobada', 'rechazada'],
    default: 'pendiente'
  }
});

// ============================================================
// LOG DE TIEMPOS (HISTORIAL COMPLETO)
// ============================================================
const logTiempoSchema = new mongoose.Schema({
  timestamp: {
    type: Date,
    default: Date.now
  },
  tipo: {
    type: String,
    enum: [
      'sugerido_supervisor',
      'estimado_tecnico',
      'recalculado_progreso',
      'tarea_iniciada',
      'tarea_pausada',
      'tarea_reanudada',
      'tarea_finalizada',
      'tarea_auto_finalizada',
      'tarea_devuelta',
      'tarea_reasignada',
      'tiempo_estimado_tecnico_reasignacion'
    ],
    required: true
  },
  tiempoMinutos: {
    type: Number,
    default: 0
  },
  tiempoAnterior: {
    type: Number,
    default: 0
  },
  tiempoReal: {
    type: Number,
    default: 0
  },
  diferencia: {
    type: Number,
    default: 0
  },
  progreso: {
    type: Number,
    default: 0
  },
  tiempoTrabajado: {
    type: Number,
    default: 0
  },
  por: {
    type: String,
    default: 'Sistema'
  },
  rol: {
    type: String,
    enum: ['supervisor', 'tecnico', 'usuario', 'Sistema'],
    default: 'Sistema'
  },
  motivo: {
    type: String,
    default: ''
  },
  eficiencia: {
    type: String,
    enum: ['mayor_a_esperado', 'esperado', 'menor_a_esperado', 'critico'],
    default: 'esperado'
  },
  tiempoRestante: {
    type: Number,
    default: 0
  },
  tecnicoAnterior: {
    type: String,
    default: ''
  },
  tecnicoNuevo: {
    type: String,
    default: ''
  },
  alerta: {
    type: Boolean,
    default: false
  }
});

const tarjetasSchema = new mongoose.Schema({
  titulo: {
    type: String,
    required: true
  },
  descripcion: String,
  tipo: {
    type: String,
    enum: ['solicitud_cliente', 'tarea_extra', 'asignacion_supervisor'],
    required: true
  },
  
  asignadaPor: {
    type: String,
    enum: ['auto', 'supervisor', 'empleado'],
    default: 'auto'
  },
  asignadoA: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  asignadoPor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  
  estado: {
    type: String,
    enum: ['pendiente', 'en_progreso', 'revision_supervisor', 'revision_cliente', 'finalizada'],
    default: 'pendiente'
  },
  
  estadoProgreso: {
    type: String,
    enum: ['activa', 'pausada', 'pendiente', 'completada'],
    default: 'pendiente'
  },
  
  porcentajeCompletado: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  
  tiempoAcumulado: {
    type: Number,
    default: 0
  },
  
  // ============================================================
  // 🔥 NUEVO: CONTROL DE TIEMPO PAUSADO
  // ============================================================
  tiempoPausadoTotal: {
    type: Number,
    default: 0  // minutos totales que la tarea ha estado pausada
  },
  fechaUltimaPausa: {
    type: Date,
    default: null  // momento en que se pausó por última vez
  },
  
  registroHoras: [registroHorasSchema],
  tolerancias: [toleranciaSchema],
  
  horasEstimadas: {
    type: Number,
    default: 0
  },
  minutosEstimados: {
    type: Number,
    default: 0
  },
  horasTotalesReales: {
    type: Number,
    default: 0
  },
  minutosTotalesReales: {
    type: Number,
    default: 0
  },
  
  tiempoSugeridoSupervisor: {
    type: Number,
    default: 0
  },
  tiempoEstimadoEmpleado: {
    type: Number,
    default: 0
  },
  
  logTiempos: [logTiempoSchema],
  
  fechaInicioReal: Date,
  fechaEstimadaFin: Date,
  fechaUltimaReanudacion: Date,
  
  fechaLimite: Date,
  fechaInicio: Date,
  fechaCompletadaEmpleado: Date,
  fechaRevisionSupervisor: Date,
  fechaRevisionCliente: Date,
  fechaFinalizada: Date,
  
  fechaExpiracionRevisionSupervisor: Date,
  fechaExpiracionCalificacion: Date,
  
  revisionSupervisor: {
    type: String,
    enum: ['pendiente', 'aprobada'],
    default: 'pendiente'
  },
  estadoCalificacion: {
    type: String,
    enum: ['pendiente', 'calificada', 'expirada', 'no_aplica'],
    default: 'no_aplica'
  },
  
  clienteInfo: {
    logueado: {
      type: Boolean,
      default: false
    },
    nombre: String,
    email: String,
    telefono: String,
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },
  
  calificacion: {
    puntaje: Number,
    comentario: String,
    fecha: Date,
    clienteId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },
  
  prioridad: {
    type: String,
    enum: ['baja', 'media', 'alta', 'urgente'],
    default: 'media'
  },
  
  activo: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

export default mongoose.model('Tarjeta', tarjetasSchema);