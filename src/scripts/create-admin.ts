/**
 * سكربت لإنشاء حساب Administrator يدويًا من الطرفية فقط.
 * لا يوجد ولا يجب أن يوجد أي API endpoint عام لإنشاء هذا الدور.
 *
 * الاستخدام:
 *   npx ts-node src/scripts/create-admin.ts <email> <password> <firstName> <lastName>
 *
 * مثال:
 *   npx ts-node src/scripts/create-admin.ts admin@mabrouk.com "StrongPass123!" مبروك المدير
 */
import 'dotenv/config';
import * as bcrypt from 'bcrypt';
import { PrismaClient } from '../generated/prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';

async function main() {
  const [email, password, firstName, lastName] = process.argv.slice(2);

  if (!email || !password || !firstName || !lastName) {
    console.error(
      'الاستخدام: npx ts-node src/scripts/create-admin.ts <email> <password> <firstName> <lastName>',
    );
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('كلمة المرور يجب أن تكون 8 أحرف على الأقل.');
    process.exit(1);
  }

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not defined in .env');
  const parsed = new URL(url);
  const adapter = new PrismaMariaDb({
    host: parsed.hostname,
    port: Number(parsed.port || 3306),
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace('/', ''),
  });

  const prisma = new PrismaClient({ adapter });

  try {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      console.error(`❌ البريد الإلكتروني "${email}" مستخدم بالفعل (الدور الحالي: ${existing.role}).`);
      process.exit(1);
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const admin = await prisma.user.create({
      data: {
        firstName,
        lastName,
        email,
        passwordHash,
        role: 'ADMINISTRATOR',
        accountStatus: 'APPROVED',
        emailVerifiedAt: new Date(),
      },
    });

    console.log('✅ تم إنشاء حساب Administrator بنجاح:');
    console.log(`   id: ${admin.id}`);
    console.log(`   email: ${admin.email}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('حدث خطأ:', err);
  process.exit(1);
});