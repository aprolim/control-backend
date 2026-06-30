// models/User.js
import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  // ============================================================
  // DATOS DEL USUARIO (se sincronizan con Zimbra)
  // ============================================================
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
  
  // ============================================================
  // DATOS DE ZIMBRA
  // ============================================================
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
  
  // ============================================================
  // ROL Y PERMISOS
  // ============================================================
  rol: {
    type: String,
    enum: ['jefe', 'empleado', 'cliente'],
    required: true,
    default: 'cliente'  // ⚠️ ROL POR DEFECTO: CLIENTE
  },
  telefono: String,
  avatar: String,
  nivel: {
    type: Number,
    default: 1
  },
  
  // ============================================================
  // DATOS DE TRABAJO
  // ============================================================
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
      enum: ['revision_cliente', 'revision_jefe', 'ambas'],
      default: 'revision_cliente'
    },
    diasMaximosCliente: {
      type: Number,
      default: 5,
      min: 1,
      max: 30
    },
    diasMaximosJefe: {
      type: Number,
      default: 3,
      min: 1,
      max: 15
    },
    accionAuto: {
      type: String,
      enum: ['finalizar', 'notificar_jefe', 'escalar', 'reabrir'],
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