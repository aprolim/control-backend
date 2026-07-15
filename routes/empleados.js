// routes/empleados.js
import express from 'express';
import User from '../models/User.js';
import { protect, supervisorOnly } from '../middleware/auth.js';

const router = express.Router();

router.get('/', protect, supervisorOnly, async (req, res) => {
  try {
    const tecnicos = await User.find({ 
      rol: { $in: ['tecnico', 'usuario'] }, 
      activo: true 
    })
      .select('-password')
      .sort('nombre');
    
    const tecnicosFormateados = tecnicos.map(emp => ({
      _id: emp._id,
      nombre: emp.nombre,
      email: emp.email,
      telefono: emp.telefono || '',
      rol: emp.rol,
      horasTrabajadasHoy: emp.horasTrabajadasHoy || 0,
      tareasActivas: emp.tareasActivas || []
    }));
    
    res.json(tecnicosFormateados);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.get('/todos', protect, supervisorOnly, async (req, res) => {
  try {
    const usuarios = await User.find({ activo: true })
      .select('-password')
      .sort('nombre');
    
    res.json(usuarios);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.put('/:userId/rol', protect, supervisorOnly, async (req, res) => {
  try {
    const { userId } = req.params;
    const { rol } = req.body;

    if (!['supervisor', 'tecnico', 'usuario'].includes(rol)) {
      return res.status(400).json({
        success: false,
        error: 'Rol inválido. Debe ser: supervisor, tecnico o usuario'
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'Usuario no encontrado'
      });
    }

    if (userId === req.user._id.toString()) {
      return res.status(400).json({
        success: false,
        error: 'No puedes cambiar tu propio rol'
      });
    }

    if (user.rol === 'supervisor' && rol !== 'supervisor') {
      const countSupervisores = await User.countDocuments({ 
        rol: 'supervisor', 
        _id: { $ne: userId },
        activo: true 
      });
      
      if (countSupervisores === 0) {
        return res.status(400).json({
          success: false,
          error: 'No se puede quitar el rol de supervisor. Debe haber al menos un supervisor en el sistema.'
        });
      }
    }

    user.rol = rol;
    await user.save();

    console.log(`✅ Rol actualizado: ${user.email} -> ${user.rol}`);

    const io = req.app.get('io');
    const clients = req.app.get('clients');
    const socket = clients.get(userId);
    if (socket) {
      socket.emit('rol-actualizado', {
        userId: user._id,
        nuevoRol: user.rol,
        mensaje: `Tu rol ha sido actualizado a: ${user.rol}`
      });
    }

    res.json({
      success: true,
      message: `Rol actualizado a ${rol}`,
      user: {
        _id: user._id,
        nombre: user.nombre,
        email: user.email,
        rol: user.rol
      }
    });

  } catch (error) {
    console.error('❌ Error actualizando rol:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Error actualizando rol'
    });
  }
});

router.get('/supervisores', protect, async (req, res) => {
  try {
    const supervisores = await User.find({ 
      rol: 'supervisor', 
      activo: true 
    }).select('_id nombre email');
    
    res.json(supervisores);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;