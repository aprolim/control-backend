import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import User from '../models/User.js';
import Tarjeta from '../models/Tarjeta.js';

dotenv.config();

const usuariosPrueba = [
  {
    nombre: "Jefe Principal",
    email: "jefe@test.com",
    password: "123456", // Contraseña en texto plano
    rol: "jefe",
    telefono: "555-0101",
    nivel: 5
  },
  {
    nombre: "Carlos Rodríguez",
    email: "carlos@empresa.com",
    password: "123456",
    rol: "empleado",
    telefono: "555-0102",
    nivel: 3
  },
  {
    nombre: "María González",
    email: "maria@empresa.com",
    password: "123456",
    rol: "empleado",
    telefono: "555-0103",
    nivel: 4
  },
  {
    nombre: "Juan Pérez",
    email: "juan@empresa.com",
    password: "123456",
    rol: "empleado",
    telefono: "555-0104",
    nivel: 2
  },
  {
    nombre: "Ana Martínez",
    email: "ana@empresa.com",
    password: "123456",
    rol: "empleado",
    telefono: "555-0105",
    nivel: 3
  },
  {
    nombre: "Cliente Premium",
    email: "cliente@test.com",
    password: "123456",
    rol: "cliente",
    telefono: "555-0201",
    nivel: 2
  },
  {
    nombre: "Empresa ABC",
    email: "empresa@test.com",
    password: "123456",
    rol: "cliente",
    telefono: "555-0202",
    nivel: 1
  }
];

async function resetDatabase() {
  try {
    console.log('========================================');
    console.log('🔄 RESET BASE DE DATOS');
    console.log('========================================');
    
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Conectado a MongoDB\n');
    
    console.log('🗑️  Limpiando base de datos...');
    await User.deleteMany({});
    await Tarjeta.deleteMany({});
    console.log('✅ Datos eliminados\n');
    
    console.log('📝 Insertando usuarios de prueba...');
    
    // Crear usuarios sin hashear la contraseña (el modelo lo hará automáticamente)
    for (const usuario of usuariosPrueba) {
      // No hasheamos aquí, dejamos que el middleware del modelo lo haga
      const newUser = new User({
        nombre: usuario.nombre,
        email: usuario.email,
        password: usuario.password, // Texto plano
        rol: usuario.rol,
        telefono: usuario.telefono,
        nivel: usuario.nivel
      });
      
      await newUser.save();
      console.log(`   ✅ ${usuario.nombre} - ${usuario.email}`);
    }
    
    console.log('\n🔑 CREDENCIALES DE ACCESO:');
    console.log('━'.repeat(50));
    console.log('📧 Jefe:         jefe@test.com / 123456');
    console.log('📧 Empleados:    carlos@empresa.com / 123456');
    console.log('                 maria@empresa.com / 123456');
    console.log('                 juan@empresa.com / 123456');
    console.log('                 ana@empresa.com / 123456');
    console.log('📧 Clientes:     cliente@test.com / 123456');
    console.log('                 empresa@test.com / 123456');
    console.log('━'.repeat(50));
    console.log('\n✨ Base de datos inicializada exitosamente');
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Desconectado de MongoDB');
    process.exit(0);
  }
}

resetDatabase();