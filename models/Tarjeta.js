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