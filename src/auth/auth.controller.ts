import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { readFile, unlink } from 'fs/promises';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { randomUUID } from 'crypto';
import { AuthService } from './auth.service';
import { RegisterCustomerDto } from './dto/register-customer.dto';
import { RegisterProfessionalDto } from './dto/register-professional.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ResendVerificationEmailDto } from './dto/resend-verification-email.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register/customer')
  registerCustomer(@Body() dto: RegisterCustomerDto) {
    return this.authService.registerCustomer(dto);
  }

  @Post('register/professional')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'identityFront', maxCount: 1 },
        { name: 'identityBack', maxCount: 1 },
        { name: 'businessFront', maxCount: 1 },
      ],
      {
        storage: diskStorage({
          destination: './uploads/verification-documents',
          filename: (_req, file, callback) => {
            const uniqueName = `${randomUUID()}${extname(file.originalname).toLowerCase()}`;
            callback(null, uniqueName);
          },
        }),
        limits: { fileSize: 5 * 1024 * 1024, files: 3 }, // 5MB per image
        fileFilter: (_req, file, callback) => {
          const extension = extname(file.originalname).toLowerCase();
          if (!['.jpg', '.jpeg', '.png'].includes(extension)) {
            return callback(
              new BadRequestException('نوع الصورة غير مدعوم (JPG/PNG فقط).'),
              false,
            );
          }
          callback(null, true);
        },
      },
    ),
  )
  async registerProfessional(
    @Body() dto: RegisterProfessionalDto,
    @UploadedFiles()
    files: {
      identityFront?: Express.Multer.File[];
      identityBack?: Express.Multer.File[];
      businessFront?: Express.Multer.File[];
    } | undefined,
  ) {
    const uploadedFiles = Object.values(files ?? {}).flat();
    for (const file of uploadedFiles) {
      const content = await readFile(file.path);
      const extension = extname(file.originalname).toLowerCase();
      const isPng =
        extension === '.png' &&
        content.subarray(0, 8).equals(
          Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        );
      const isJpeg =
        (extension === '.jpg' || extension === '.jpeg') &&
        content.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));

      if (!isPng && !isJpeg) {
        await Promise.all(uploadedFiles.map((uploadedFile) => unlink(uploadedFile.path)));
        throw new BadRequestException(
          'محتوى الصورة لا يطابق صيغ PNG أو JPG المدعومة.',
        );
      }
    }

    try {
      return await this.authService.registerProfessional(dto, {
        identityFrontPath: files?.identityFront?.[0]
          ? `verification-documents/${files.identityFront[0].filename}`
          : '',
        identityBackPath: files?.identityBack?.[0]
          ? `verification-documents/${files.identityBack[0].filename}`
          : '',
        businessFrontPath: files?.businessFront?.[0]
          ? `verification-documents/${files.businessFront[0].filename}`
          : undefined,
      });
    } catch (error) {
      await Promise.all(uploadedFiles.map((file) => unlink(file.path)));
      throw error;
    }
  }

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @Post('verify-email')
  verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.authService.verifyEmail(dto);
  }

  @Post('resend-verification-email')
  resendVerificationEmail(@Body() dto: ResendVerificationEmailDto) {
    return this.authService.resendVerificationEmail(dto);
  }
}