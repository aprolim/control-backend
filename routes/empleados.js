// routes/empleados.js - Con gestión de roles
import express from 'express';
import User from '../models/User.js';
import { protect, jefeOnly } from '../middleware/auth.js';

const router = express.Router();

// ============================================================
// Obtener todos los empleados (solo jefe)
// ============================================================
router.get('/', protect, jefeOnly, async (req, res) => {
  try {
    const empleados = await User.find({ 
      rol: { $in: ['empleado', 'cliente'] }, 
      activo: true 
    })
      .select('-password')
      .sort('nombre');
    
    const empleadosFormateados = empleados.map(emp => ({
      _id: emp._id,
      nombre: emp.nombre,
      email: emp.email,
      telefono: emp.telefono || '',
      rol: emp.rol,
      horasTrabajadasHoy: emp.horasTrabajadasHoy || 0,
      tareasActivas: emp.tareasActivas || []
    }));
    
    res.json(empleadosFormateados);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ============================================================
// Obtener todos los usuarios (incluyendo jefes) - solo jefe
// ============================================================
router.get('/todos', protect, jefeOnly, async (req, res) => {
  try {
    const usuarios = await User.find({ activo: true })
      .select('-password')
      .sort('nombre');
    
    res.json(usuarios);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ============================================================
// ACTUALIZAR ROL DE UN USUARIO (SOLO JEFES)
// ============================================================
router.put('/:userId/rol', protect, jefeOnly, async (req, res) => {
  try {
    const { userId } = req.params;
    const { rol } = req.body;

    // Validar rol
    if (!['jefe', 'empleado', 'cliente'].includes(rol)) {
      return res.status(400).json({
        success: false,
        error: 'Rol inválido. Debe ser: jefe, empleado o cliente'
      });
    }

    // Verificar que el usuario existe
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'Usuario no encontrado'
      });
    }

    // No permitir cambiar el propio rol
    if (userId === req.user._id.toString()) {
      return res.status(400).json({
        success: false,
        error: 'No puedes cambiar tu propio rol'
      });
    }

    // VERIFICAR: Si se está quitando el rol de jefe, asegurar que quede al menos uno
    if (user.rol === 'jefe' && rol !== 'jefe') {
      const countJefes = await User.countDocuments({ 
        rol: 'jefe', 
        _id: { $ne: userId },
        activo: true 
      });
      
      if (countJefes === 0) {
        return res.status(400).json({
          success: false,
          error: 'No se puede quitar el rol de jefe. Debe haber al menos un jefe en el sistema.'
        });
      }
    }

    // Actualizar rol
    user.rol = rol;
    await user.save();

    console.log(`✅ Rol actualizado: ${user.email} -> ${user.rol}`);

    // Notificar via Socket.IO
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

// ============================================================
// Obtener lista de jefes (para validaciones)
// ============================================================
router.get('/jefes', protect, async (req, res) => {
  try {
    const jefes = await User.find({ 
      rol: 'jefe', 
      activo: true 
    }).select('_id nombre email');
    
    res.json(jefes);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;