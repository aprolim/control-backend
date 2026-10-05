// models/User.js
import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  nombre: {
    type: String,
    required: true
  },
  email: {
    type: String,
    required: true,
    unique: true
  },
  password: {
    type: String,
    default: 'zimbra_user'
  },
  zimbraUid: {
    type: String,
    unique: true,
    sparse: true,
    index: true
  },
  zimbraToken: {
    type: String,
    default: null
  },
  zimbraTokenExpiry: {
    type: Date,
    default: null
  },
  rol: {
    type: String,
    enum: ['supervisor', 'tecnico', 'usuario'],
    required: true,
    default: 'usuario'
  },
  telefono: String,
  avatar: String,
  nivel: {
    type: Number,
    default: 1
  },
  horasTrabajadasHoy: {
    type: Number,
    default: 0
  },
  tareasActivas: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tarjeta'
  }],
  ultimoRegistroHoras: Date,
  configuracionTolerancia: {
    autoAprobarHasta: {
      type: Number,
      default: 2
    },
    requiereAprobacion: {
      type: Boolean,
      default: true
    }
  },
  configuracionAutoCierre: {
    revisarColumna: {
      type: String,
      enum: ['revision_cliente', 'revision_supervisor', 'ambas'],
      default: 'revision_cliente'
    },
    diasMaximosCliente: {
      type: Number,
      default: 5,
      min: 1,
      max: 30
    },
    diasMaximosSupervisor: {
      type: Number,
      default: 3,
      min: 1,
      max: 15
    },
    accionAuto: {
      type: String,
      enum: ['finalizar', 'notificar_supervisor', 'escalar', 'reabrir'],
      default: 'finalizar'
    },
    notificarAntesDias: {
      type: Number,
      default: 1,
      min: 0,
      max: 5
    },
    habilitado: {
      type: Boolean,
      default: true
    },
    excepcionesEmpleados: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }]
  },
  
  // ============================================================
  // 🔥 NUEVO: Configuración de notificaciones (sonidos y visuales)
  // ============================================================
  configuracionNotificaciones: {
    // Notificación 1: Recordatorio de tareas pendientes
    recordatorioPendientes: {
      habilitado: {
        type: Boolean,
        default: true
      },
      intervaloMinutos: {
        type: Number,
        default: 2,       // cada cuántos minutos sonar
        min: 1,
        max: 30
      },
      sonidoHabilitado: {
        type: Boolean,
        default: true
      },
      soloCuandoLibre: {
        type: Boolean,
        default: true    // solo suena si el técnico no tiene tarea activa
      }
    },
    
    // Notificación 2: Nueva tarea entra a pendiente
    nuevaTareaPendiente: {
      habilitado: {
        type: Boolean,
        default: true
      },
      sonidoHabilitado: {
        type: Boolean,
        default: true
      }
    },
    
    // Notificación 3: Supervisor asigna tarea específica
    tareaAsignada: {
      habilitado: {
        type: Boolean,
        default: true
      },
      sonidoHabilitado: {
        type: Boolean,
        default: true
      }
    },
    
    // Configuración global de sonido
    volumen: {
      type: Number,
      default: 0.5,
      min: 0,
      max: 1
    },
    silenciarHasta: {
      type: Date,
      default: null
    }
  },
  
  // 🔥 NUEVO: Solicitudes rápidas predefinidas
  solicitudesPredefinidas: [{
    titulo: {
      type: String,
      required: true
    },
    descripcion: {
      type: String,
      default: ''
    },
    prioridad: {
      type: String,
      enum: ['baja', 'media', 'alta', 'urgente'],
      default: 'media'
    },
    activo: {
      type: Boolean,
      default: true
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  activo: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

userSchema.methods.comparePassword = async function(candidatePassword) {
  return false;
};

export default mongoose.model('User', userSchema);