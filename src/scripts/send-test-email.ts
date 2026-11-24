import 'dotenv/config';
import process from 'node:process';
import { NestFactory } from '@nestjs/core';
import { EmailModule } from '../email/email.module';
import { EmailService } from '../email/email.service';

const html = `
<!doctype html>
<html lang="ar" dir="rtl">
  <body style="margin:0;background-color:#FFFFFF;color:#333333;font-family:Arial,sans-serif;">
    <div style="max-width:600px;margin:32px auto;padding:32px;border:1px solid #eeeeee;border-radius:12px;">
      <div style="height:8px;background-color:#701F35;border-radius:8px;"></div>
      <h1 style="color:#701F35;margin:24px 0 12px;">مبروك</h1>
      <div style="width:64px;height:3px;background-color:#C6A15B;"></div>
      <p style="font-size:16px;line-height:1.8;">هذه رسالة اختبار واحدة لتأكيد إعداد البريد الإلكتروني في Mabrouk.</p>
      <p style="color:#701F35;font-weight:bold;">Mabrouk</p>
    </div>
  </body>
</html>`;

async function main() {
  const app = await NestFactory.createApplicationContext(EmailModule, {
    logger: false,
  });

  try {
    const emailService = app.get(EmailService);
    const result = await emailService.sendEmail({
      to: 'alalomagd4@gmail.com',
      subject: 'رسالة اختبار من Mabrouk',
      html,
      text: 'هذه رسالة اختبار واحدة لتأكيد إعداد البريد الإلكتروني في Mabrouk.',
    });
    console.log(`Test email sent. Message ID: ${result.messageId}`);
  } finally {
    await app.close();
  }
}

main().catch(() => {
  console.error('Test email failed. Check SMTP settings and connectivity.');
  process.exitCode = 1;
});
