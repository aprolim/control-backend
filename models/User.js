import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

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
    required: true
  },
  rol: {
    type: String,
    enum: ['jefe', 'empleado', 'cliente'],
    required: true
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
  activo: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

export default mongoose.model('User', userSchema);