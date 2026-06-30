// scripts/reset-completo.js
// 
// PROPÓSITO: Resetear la base de datos para el sistema de login Zimbra
// 
// REGLAS:
//   - Rol por defecto: cliente
//   - Jefe inicial: grover.plaza@senado.gob.bo (se crea automáticamente)
//   - Solo jefes pueden asignar roles
//   - Siempre debe haber al menos un jefe
//   - El resto de usuarios se crean al primer login con Zimbra
//
// USO:
//   node scripts/reset-completo.js
//

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from '../models/User.js';
import Tarjeta from '../models/Tarjeta.js';

dotenv.config();

// ============================================================
// CONFIGURACIÓN
// ============================================================

const JEFE_INICIAL = {
    email: 'grover.plaza@senado.gob.bo',
    nombre: 'GROVER PLAZA QUIROGA',
    rol: 'jefe',
    zimbraUid: 'grover.plaza',
    telefono: '',
    password: 'zimbra_user'
};

// ============================================================
// FUNCIÓN PRINCIPAL
// ============================================================

async function resetCompleto() {
    console.log('\n');
    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║  🔄 RESET COMPLETO DE BASE DE DATOS                          ║');
    console.log('║  Sistema de login Zimbra                                    ║');
    console.log('╚════════════════════════════════════════════════════════════════╝');
    console.log('\n');

    try {
        // 1. Conectar a MongoDB
        console.log('📡 Conectando a MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('   ✅ Conectado\n');

        const db = mongoose.connection.db;
        console.log(`   📊 Base de datos: ${db.databaseName}\n`);

        // 2. Contar antes de eliminar
        const countBeforeUsers = await User.countDocuments();
        const countBeforeTarjetas = await Tarjeta.countDocuments();
        console.log(`   📋 Antes de limpiar:`);
        console.log(`      - Usuarios: ${countBeforeUsers}`);
        console.log(`      - Tarjetas: ${countBeforeTarjetas}\n`);

        // 3. ELIMINAR TODO
        console.log('🗑️  Eliminando datos existentes...');
        const userDeleteResult = await User.deleteMany({});
        const tarjetaDeleteResult = await Tarjeta.deleteMany({});
        console.log(`   ✅ Usuarios eliminados: ${userDeleteResult.deletedCount}`);
        console.log(`   ✅ Tarjetas eliminadas: ${tarjetaDeleteResult.deletedCount}\n`);

        // 4. Crear JEFE INICIAL
        console.log('👔 Creando JEFE INICIAL...');
        const jefe = new User({
            nombre: JEFE_INICIAL.nombre,
            email: JEFE_INICIAL.email,
            rol: JEFE_INICIAL.rol,
            zimbraUid: JEFE_INICIAL.zimbraUid,
            telefono: JEFE_INICIAL.telefono,
            password: JEFE_INICIAL.password,
            activo: true,
            configuracionAutoCierre: {
                habilitado: true,
                revisarColumna: 'revision_cliente',
                diasMaximosCliente: 5,
                diasMaximosJefe: 3,
                accionAuto: 'finalizar',
                notificarAntesDias: 1,
                excepcionesEmpleados: []
            }
        });
        await jefe.save();
        console.log(`   ✅ ${jefe.email} - ${jefe.rol}\n`);

        // 5. MOSTRAR RESUMEN
        console.log('╔════════════════════════════════════════════════════════════════╗');
        console.log('║  📊 RESUMEN FINAL                                            ║');
        console.log('╠════════════════════════════════════════════════════════════════╣');
        console.log(`║  Total usuarios: 1                                           ║`);
        console.log(`║  ├─ 👔 Jefes:     1                                         ║`);
        console.log(`║  ├─ 👷 Empleados: 0 (se crean al primer login)              ║`);
        console.log(`║  └─ 👤 Clientes:  0 (se crean al primer login)              ║`);
        console.log('╠════════════════════════════════════════════════════════════════╣');
        console.log(`║  👑 JEFE INICIAL: ${JEFE_INICIAL.email}`);
        console.log('╠════════════════════════════════════════════════════════════════╣');
        console.log('║  🔑 Para iniciar sesión usa tus credenciales de Zimbra       ║');
        console.log('║  📧 El jefe inicial es: grover.plaza@senado.gob.bo           ║');
        console.log('║  📌 Nuevos usuarios se crean automáticamente al loguearse    ║');
        console.log('║  📌 Rol por defecto: cliente                                ║');
        console.log('╚════════════════════════════════════════════════════════════════╝');
        console.log('\n');

        // 6. DIAGNÓSTICO FINAL
        const countJefes = await User.countDocuments({ rol: 'jefe', activo: true });
        if (countJefes === 0) {
            console.warn('⚠️ ¡ADVERTENCIA! No hay jefes en el sistema.');
            console.warn('   Esto puede causar problemas. Asegúrate de tener al menos un jefe.');
        } else {
            console.log(`✅ Verificación: ${countJefes} jefe(s) en el sistema (mínimo requerido: 1)`);
        }

        console.log('\n✨ Base de datos inicializada exitosamente');
        console.log('✅ Listo para usar el sistema con login Zimbra\n');

    } catch (error) {
        console.error('❌ ERROR:', error);
        console.error('   Detalles:', error.message);
        process.exit(1);
    } finally {
        await mongoose.disconnect();
        console.log('\n🔌 Desconectado de MongoDB');
        process.exit(0);
    }
}

// ============================================================
// EJECUTAR
// ============================================================

resetCompleto();