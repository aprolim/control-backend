import express from 'express';
import User from '../models/User.js';
import { protect, jefeOnly } from '../middleware/auth.js';

const router = express.Router();

// Obtener todos los empleados (solo jefe)
router.get('/', protect, jefeOnly, async (req, res) => {
  try {
    const empleados = await User.find({ rol: 'empleado', activo: true })
      .select('-password')
      .sort('nombre');
    
    const empleadosFormateados = empleados.map(emp => ({
      _id: emp._id,
      nombre: emp.nombre,
      email: emp.email,
      telefono: emp.telefono || '',
      horasTrabajadasHoy: emp.horasTrabajadasHoy || 0,
      tareasActivas: emp.tareasActivas || []
    }));
    
    res.json(empleadosFormateados);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;