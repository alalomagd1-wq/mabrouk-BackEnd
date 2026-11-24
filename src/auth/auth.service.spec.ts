import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import * as bcrypt from 'bcrypt';
import { validateSync } from 'class-validator';
import {
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { AuthService } from './auth.service';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

type RecordValue = Record<string, any>;

class MemoryPrisma {
  users: RecordValue[] = [];
  pendingRegistrations: RecordValue[] = [];
  verificationRequests: RecordValue[] = [];
  activityLogs: RecordValue[] = [];
  private nextUserId = 1;
  private nextPendingId = 1;
  private transactionTail: Promise<void> = Promise.resolve();

  readonly user = {
    findUnique: async ({ where }: RecordValue) =>
      this.users.find((user) => user.email === where.email) ?? null,
    findFirst: async ({ where }: RecordValue) => {
      const tokenHash = where.AND.find(
        (condition: RecordValue) => condition.passwordResetToken,
      )?.passwordResetToken;
      const expiry = where.AND.find(
        (condition: RecordValue) => condition.passwordResetExpiresAt,
      )?.passwordResetExpiresAt.gt;
      return (
        this.users.find(
          (user) =>
            user.passwordResetToken === tokenHash &&
            user.passwordResetExpiresAt > expiry,
        ) ?? null
      );
    },
    update: async ({ where, data }: RecordValue) => {
      const user = this.users.find((candidate) => candidate.id === where.id);
      if (!user) throw new Error('User not found');
      Object.assign(user, data);
      return user;
    },
    create: async ({ data }: RecordValue) => {
      if (this.users.some((user) => user.email === data.email)) {
        throw Object.assign(new Error('unique'), { code: 'P2002' });
      }
      const user = { id: this.nextUserId++, ...data };
      this.users.push(user);
      return user;
    },
    updateMany: async ({ where, data }: RecordValue) => {
      const user = this.users.find(
        (candidate) =>
          candidate.id === where.id &&
          (where.passwordResetToken === undefined ||
            candidate.passwordResetToken === where.passwordResetToken) &&
          (where.passwordResetExpiresAt?.gt === undefined ||
            candidate.passwordResetExpiresAt > where.passwordResetExpiresAt.gt) &&
          (where.passwordResetAttempts?.lt === undefined ||
            candidate.passwordResetAttempts < where.passwordResetAttempts.lt) &&
          (where.passwordResetAttempts?.lte === undefined ||
            candidate.passwordResetAttempts <= where.passwordResetAttempts.lte),
      );
      if (!user) return { count: 0 };
      const updates = { ...data };
      if (typeof updates.passwordResetAttempts === 'object') {
        updates.passwordResetAttempts =
          user.passwordResetAttempts + updates.passwordResetAttempts.increment;
      }
      Object.assign(user, updates);
      return { count: 1 };
    },
  };

  readonly pendingRegistration = {
    findUnique: async ({ where }: RecordValue) =>
      this.pendingRegistrations.find(
        (registration) => registration.email === where.email,
      ) ?? null,
    findFirst: async ({ where }: RecordValue) =>
      this.pendingRegistrations.find(
        (registration) =>
          registration.verificationTokenHash ===
            where.verificationTokenHash &&
          registration.expiresAt > where.expiresAt.gt,
      ) ?? null,
    findMany: async ({ where }: RecordValue) =>
      this.pendingRegistrations.filter(
        (registration) => registration.expiresAt <= where.expiresAt.lte,
      ),
    create: async ({ data }: RecordValue) => {
      if (
        this.pendingRegistrations.some(
          (registration) =>
            registration.email === data.email ||
            registration.verificationTokenHash ===
              data.verificationTokenHash,
        )
      ) {
        throw Object.assign(new Error('unique'), { code: 'P2002' });
      }
      const registration = { id: this.nextPendingId++, ...data };
      registration.resendWindowStartedAt ??= new Date();
      registration.resendCount ??= 0;
      this.pendingRegistrations.push(registration);
      return registration;
    },
    updateMany: async ({ where, data }: RecordValue) => {
      const registration = this.pendingRegistrations.find(
        (candidate) =>
          candidate.id === where.id &&
          candidate.verificationTokenHash ===
            where.verificationTokenHash &&
          (!where.resendAvailableAt?.lte ||
            candidate.resendAvailableAt <= where.resendAvailableAt.lte) &&
          (where.resendCount === undefined ||
            candidate.resendCount === where.resendCount) &&
          (!where.resendWindowStartedAt ||
            candidate.resendWindowStartedAt.getTime() ===
              where.resendWindowStartedAt.getTime()) &&
          (where.expiresAt?.gt === undefined ||
            candidate.expiresAt > where.expiresAt.gt) &&
          (where.verificationAttempts?.lt === undefined ||
            candidate.verificationAttempts < where.verificationAttempts.lt),
      );
      if (!registration) return { count: 0 };
      const updates = { ...data };
      if (typeof updates.resendCount === 'object') {
        updates.resendCount =
          registration.resendCount + updates.resendCount.increment;
      }
      if (typeof updates.verificationAttempts === 'object') {
        updates.verificationAttempts =
          registration.verificationAttempts +
          updates.verificationAttempts.increment;
      }
      Object.assign(registration, updates);
      return { count: 1 };
    },
    deleteMany: async ({ where }: RecordValue) => {
      const index = this.pendingRegistrations.findIndex((registration) => {
        if (registration.id !== where.id) return false;
        if (
          where.verificationTokenHash &&
          registration.verificationTokenHash !==
            where.verificationTokenHash
        ) {
          return false;
        }
        if (
          where.expiresAt?.gt &&
          registration.expiresAt <= where.expiresAt.gt
        ) {
          return false;
        }
        if (
          where.expiresAt?.lte &&
          registration.expiresAt > where.expiresAt.lte
        ) {
          return false;
        }
        if (
          where.expiresAt instanceof Date &&
          registration.expiresAt.getTime() !== where.expiresAt.getTime()
        ) {
          return false;
        }
        if (
          where.verificationAttempts?.lte !== undefined &&
          registration.verificationAttempts > where.verificationAttempts.lte
        ) {
          return false;
        }
        return true;
      });
      if (index < 0) return { count: 0 };
      this.pendingRegistrations.splice(index, 1);
      return { count: 1 };
    },
  };

  readonly verificationRequest = {
    create: async ({ data }: RecordValue) => {
      this.verificationRequests.push(data);
      return data;
    },
  };

  readonly activityLog = {
    create: async ({ data }: RecordValue) => {
      this.activityLogs.push(data);
      return data;
    },
  };

  async $transaction<T>(operation: (tx: this) => Promise<T>): Promise<T> {
    const previous = this.transactionTail;
    let release!: () => void;
    this.transactionTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;

    const snapshot = {
      users: [...this.users],
      pendingRegistrations: [...this.pendingRegistrations],
      verificationRequests: [...this.verificationRequests],
      activityLogs: [...this.activityLogs],
    };
    try {
      return await operation(this);
    } catch (error) {
      this.users = snapshot.users;
      this.pendingRegistrations = snapshot.pendingRegistrations;
      this.verificationRequests = snapshot.verificationRequests;
      this.activityLogs = snapshot.activityLogs;
      throw error;
    } finally {
      release();
    }
  }
}

class MemoryEmailService {
  sent: Array<{ email: string; code: string }> = [];
  sentEmails: RecordValue[] = [];
  fail = false;
  emailError: unknown;

  async sendVerificationEmail(email: string, code: string) {
    if (this.fail) throw new Error('SMTP failure with sensitive details');
    this.sent.push({ email, code });
  }

  async sendEmail(options: RecordValue) {
    if (this.emailError) throw this.emailError;
    this.sentEmails.push(options);
  }
}

function createService(prisma = new MemoryPrisma(), email = new MemoryEmailService()) {
  const jwt = { sign: () => 'test-jwt' };
  const service = new AuthService(
    prisma as unknown as PrismaService,
    jwt as any,
    email as unknown as EmailService,
  );
  return { service, prisma, email };
}

function customerRegistration(overrides: RecordValue = {}) {
  return {
    firstName: 'First',
    lastName: 'Customer',
    phone: '+12345678',
    email: 'customer@example.com',
    password: 'StrongPassword123',
    ...overrides,
  };
}

function professionalRegistration(
  role: 'EVENT_MANAGER' | 'SERVICE_OWNER',
  overrides: RecordValue = {},
) {
  return {
    firstName: 'First',
    lastName: 'Professional',
    phone: '+12345678',
    email: `${role.toLowerCase()}@example.com`,
    password: 'StrongPassword123',
    role,
    ...overrides,
  };
}

test('registration stores only password and verification-code hashes', async () => {
  const { service, prisma, email } = createService();
  const registration = customerRegistration();

  const response = await service.registerCustomer(registration);

  assert.equal(response.verificationRequired, true);
  assert.equal(prisma.users.length, 0);
  assert.equal(prisma.pendingRegistrations.length, 1);
  assert.notEqual(
    prisma.pendingRegistrations[0].passwordHash,
    registration.password,
  );
  assert.equal(
    await bcrypt.compare(
      registration.password,
      prisma.pendingRegistrations[0].passwordHash,
    ),
    true,
  );
  assert.equal(email.sent.length, 1);
  assert.equal(email.sent[0].email, registration.email);
  assert.match(email.sent[0].code, /^\d{6}$/);
  assert.equal(prisma.pendingRegistrations[0].verificationAttempts, 0);
  assert.notEqual(prisma.pendingRegistrations[0].verificationTokenHash, email.sent[0].code);
  assert.equal(
    await bcrypt.compare(
      email.sent[0].code,
      prisma.pendingRegistrations[0].verificationTokenHash,
    ),
    true,
  );
  assert.ok(
    Math.abs(
      prisma.pendingRegistrations[0].expiresAt.getTime() -
        Date.now() -
        10 * 60 * 1000,
    ) < 1_000,
  );
  assert.equal(JSON.stringify(response).includes(email.sent[0].code), false);
});

test('verify-email DTO accepts six-digit strings with leading zero only', () => {
  const valid = Object.assign(new VerifyEmailDto(), {
    email: 'customer@example.com',
    code: '000042',
  });
  const invalid = Object.assign(new VerifyEmailDto(), {
    email: 'customer@example.com',
    code: '12345',
  });

  assert.deepEqual(validateSync(valid), []);
  assert.ok(validateSync(invalid).some((error) => error.property === 'code'));
});

test('professional roles stay pending approval and preserve verification documents', async () => {
  for (const role of ['EVENT_MANAGER', 'SERVICE_OWNER'] as const) {
    const { service, prisma, email } = createService();
    const docs = {
      identityFrontPath: 'verification-documents/front.jpg',
      identityBackPath: 'verification-documents/back.jpg',
      businessFrontPath:
        role === 'SERVICE_OWNER'
          ? 'verification-documents/business.jpg'
          : undefined,
    };

    await service.registerProfessional(professionalRegistration(role), docs);
    assert.equal(prisma.users.length, 0);

    const result = await service.verifyEmail({
      email: professionalRegistration(role).email,
      code: email.sent[0].code,
    });

    assert.equal(prisma.users.length, 1);
    assert.equal(prisma.users[0].role, role);
    assert.equal(prisma.users[0].accountStatus, 'PENDING_VERIFICATION');
    assert.ok(prisma.users[0].emailVerifiedAt instanceof Date);
    assert.equal(prisma.verificationRequests.length, 1);
    assert.equal(prisma.verificationRequests[0].identityFrontPath, docs.identityFrontPath);
    assert.equal(prisma.verificationRequests[0].identityBackPath, docs.identityBackPath);
    assert.equal(
      prisma.verificationRequests[0].businessFrontPath,
      docs.businessFrontPath ?? null,
    );
    assert.equal(result.accountStatus, 'PENDING_VERIFICATION');
    assert.equal('accessToken' in result, false);
  }
});

test('duplicate existing account is rejected without creating a pending registration', async () => {
  const { service, prisma } = createService();
  prisma.users.push({ id: 1, email: 'customer@example.com' });

  await assert.rejects(
    service.registerCustomer(customerRegistration()),
    ConflictException,
  );
  assert.equal(prisma.pendingRegistrations.length, 0);
});

test('duplicate pending registration is rejected without sending another email', async () => {
  const { service, prisma, email } = createService();
  await service.registerCustomer(customerRegistration());

  await assert.rejects(
    service.registerCustomer(customerRegistration()),
    ConflictException,
  );
  assert.equal(prisma.pendingRegistrations.length, 1);
  assert.equal(email.sent.length, 1);
});

test('invalid and expired verification codes are rejected', async () => {
  const { service, prisma, email } = createService();
  await service.registerCustomer(customerRegistration());
  const wrongCode = email.sent[0].code === '000000' ? '000001' : '000000';
  await assert.rejects(
    service.verifyEmail({
      email: 'customer@example.com',
      code: wrongCode,
    }),
    BadRequestException,
  );

  prisma.pendingRegistrations[0].expiresAt = new Date(Date.now() - 1);
  await assert.rejects(
    service.verifyEmail({
      email: 'customer@example.com',
      code: email.sent[0].code,
    }),
    BadRequestException,
  );
  assert.equal(prisma.pendingRegistrations.length, 0);
  assert.equal(prisma.users.length, 0);
});

test('customer cannot log in before email verification', async () => {
  const { service, prisma, email } = createService();
  const registration = customerRegistration();
  await service.registerCustomer(registration);

  assert.equal(prisma.users.length, 0);
  await assert.rejects(
    service.login({
      email: registration.email,
      password: registration.password,
    }),
    UnauthorizedException,
  );

  await service.verifyEmail({
    email: registration.email,
    code: email.sent[0].code,
  });
  const login = await service.login({
    email: registration.email,
    password: registration.password,
  });
  assert.equal(login.accessToken, 'test-jwt');
  assert.equal(prisma.users.length, 1);
});

test('customer verification creates one approved account and consumes the token', async () => {
  const { service, prisma, email } = createService();
  await service.registerCustomer(customerRegistration());

  const response = await service.verifyEmail({
    email: 'customer@example.com',
    code: email.sent[0].code,
  });

  if (!('accessToken' in response)) {
    throw new Error('Customer verification should return an access token.');
  }
  assert.equal(response.accessToken, 'test-jwt');
  assert.equal(prisma.users.length, 1);
  assert.equal(prisma.users[0].role, 'CUSTOMER');
  assert.equal(prisma.users[0].accountStatus, 'APPROVED');
  assert.ok(prisma.users[0].emailVerifiedAt instanceof Date);
  assert.equal(prisma.pendingRegistrations.length, 0);
  await assert.rejects(
    service.verifyEmail({
      email: 'customer@example.com',
      code: email.sent[0].code,
    }),
    BadRequestException,
  );
  assert.equal(prisma.users.length, 1);
});

test('concurrent verification requests cannot create duplicate accounts', async () => {
  const { service, prisma, email } = createService();
  await service.registerCustomer(customerRegistration());

  const results = await Promise.allSettled([
    service.verifyEmail({
      email: 'customer@example.com',
      code: email.sent[0].code,
    }),
    service.verifyEmail({
      email: 'customer@example.com',
      code: email.sent[0].code,
    }),
  ]);

  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
  assert.equal(prisma.users.length, 1);
});

test('resend enforces cooldown and invalidates the previous token', async () => {
  const { service, prisma, email } = createService();
  await service.registerCustomer(customerRegistration());
  const oldCode = email.sent[0].code;
  prisma.pendingRegistrations[0].verificationAttempts = 3;

  await service.resendVerificationEmail({ email: 'customer@example.com' });
  assert.equal(email.sent.length, 1);

  prisma.pendingRegistrations[0].resendAvailableAt = new Date(0);
  await service.resendVerificationEmail({ email: 'customer@example.com' });

  assert.equal(email.sent.length, 2);
  assert.notEqual(email.sent[1].code, oldCode);
  assert.equal(prisma.pendingRegistrations[0].verificationAttempts, 0);
  assert.ok(
    Math.abs(
      prisma.pendingRegistrations[0].expiresAt.getTime() -
        Date.now() -
        10 * 60 * 1000,
    ) < 1_000,
  );
  await assert.rejects(
    service.verifyEmail({
      email: 'customer@example.com',
      code: oldCode,
    }),
    BadRequestException,
  );
  await service.verifyEmail({
    email: 'customer@example.com',
    code: email.sent[1].code,
  });
  assert.equal(prisma.users.length, 1);
});

test('expired pending registration is cleaned up and cannot receive a resend', async () => {
  const { service, prisma, email } = createService();
  await service.registerCustomer(customerRegistration());
  prisma.pendingRegistrations[0].expiresAt = new Date(Date.now() - 1);

  const response = await service.resendVerificationEmail({
    email: 'customer@example.com',
  });

  assert.equal(response.verificationRequired, true);
  assert.equal(prisma.pendingRegistrations.length, 0);
  assert.equal(email.sent.length, 1);
  assert.equal(prisma.users.length, 0);
});

test('resend limits each pending email to five messages per 24-hour window', async () => {
  const { service, prisma, email } = createService();
  await service.registerCustomer(customerRegistration());

  for (let attempt = 0; attempt < 5; attempt += 1) {
    prisma.pendingRegistrations[0].resendAvailableAt = new Date(0);
    await service.resendVerificationEmail({ email: 'customer@example.com' });
  }
  prisma.pendingRegistrations[0].resendAvailableAt = new Date(0);
  await service.resendVerificationEmail({ email: 'customer@example.com' });

  assert.equal(email.sent.length, 6);
  assert.equal(prisma.pendingRegistrations[0].resendCount, 5);
});

test('the fifth verification attempt can succeed and codes may start with zero', async () => {
  const { service, prisma } = createService();
  await service.registerCustomer(customerRegistration());
  prisma.pendingRegistrations[0].verificationTokenHash = await bcrypt.hash(
    '000042',
    10,
  );
  const wrongCode = '999999';

  for (let attempt = 0; attempt < 4; attempt += 1) {
    await assert.rejects(
      service.verifyEmail({
        email: 'customer@example.com',
        code: wrongCode,
      }),
      BadRequestException,
    );
  }
  assert.equal(prisma.pendingRegistrations[0].verificationAttempts, 4);

  await service.verifyEmail({
    email: 'customer@example.com',
    code: '000042',
  });
  assert.equal(prisma.users.length, 1);
});

test('verification blocks attempts after five incorrect codes', async () => {
  const { service, prisma, email } = createService();
  await service.registerCustomer(customerRegistration());
  const wrongCode = email.sent[0].code === '000000' ? '000001' : '000000';

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await assert.rejects(
      service.verifyEmail({
        email: 'customer@example.com',
        code: wrongCode,
      }),
      BadRequestException,
    );
  }

  assert.equal(prisma.pendingRegistrations[0].verificationAttempts, 5);
  await assert.rejects(
    service.verifyEmail({
      email: 'customer@example.com',
      code: email.sent[0].code,
    }),
    BadRequestException,
  );
  assert.equal(prisma.users.length, 0);
});

test('unverified final accounts cannot log in', async () => {
  const { service, prisma } = createService();
  prisma.users.push({
    id: 1,
    email: 'unverified@example.com',
    passwordHash: await bcrypt.hash('StrongPassword123', 10),
    emailVerifiedAt: null,
    accountStatus: 'APPROVED',
  });

  await assert.rejects(
    service.login({
      email: 'unverified@example.com',
      password: 'StrongPassword123',
    }),
    UnauthorizedException,
  );
});

test('verification email displays the six-digit code in accessible brand colors', async () => {
  const emailService = new EmailService();
  let sentOptions: RecordValue | undefined;
  emailService.sendEmail = async (options) => {
    sentOptions = options;
    return {} as any;
  };

  await emailService.sendVerificationEmail('recipient@example.com', '000042');
  assert.ok(sentOptions);
  assert.equal(sentOptions.to, 'recipient@example.com');
  assert.match(sentOptions.text, /000042/);
  assert.match(sentOptions.html, /#6D1833/);
  assert.match(sentOptions.html, /#C6A667/);
  assert.match(sentOptions.html, /000042/);
  assert.match(sentOptions.html, /10 دقائق/);
});

test('email failure leaves a pending registration and does not create a final account', async () => {
  const { service, prisma, email } = createService();
  email.fail = true;

  const response = await service.registerCustomer(customerRegistration());
  assert.equal(response.verificationRequired, true);
  assert.equal(prisma.pendingRegistrations.length, 1);
  assert.equal(prisma.users.length, 0);

  await service.resendVerificationEmail({ email: 'customer@example.com' });
  assert.equal(prisma.users.length, 0);
  assert.equal(prisma.pendingRegistrations.length, 1);
});

test('registration email failure logs only the error type and SMTP code', async () => {
  const { service, email } = createService();
  const diagnostics: string[] = [];
  Object.defineProperty(service, 'logger', {
    value: { warn: (message: string) => diagnostics.push(message) },
  });
  email.sendVerificationEmail = async () => {
    throw Object.assign(
      new Error('sensitive recipient, password, and verification token'),
      { code: 'EAUTH', responseCode: 535 },
    );
  };

  await service.registerCustomer(customerRegistration());

  assert.deepEqual(JSON.parse(diagnostics[0]), {
    event: 'registration_verification_email_failed',
    phase: 'email_delivery',
    errorType: 'Error',
    smtpCode: 535,
  });
});

test('resend response is consistent for unknown emails', async () => {
  const { service } = createService();
  const existing = await service.resendVerificationEmail({
    email: 'unknown@example.com',
  });
  const missing = await service.resendVerificationEmail({
    email: 'another@example.com',
  });
  assert.deepEqual(existing, missing);
});

test('forgot password sends a six-digit code, stores only its hash, and keeps a generic response', async () => {
  const { service, prisma, email } = createService();
  prisma.users.push({
    id: 1,
    email: 'customer@example.com',
    passwordHash: 'existing-hash',
    passwordResetAttempts: 0,
  });

  const response = await service.forgotPassword({
    email: 'customer@example.com',
  });

  assert.deepEqual(response, {
    message: 'إن كان هذا البريد مسجّلاً، ستصلك تعليمات إعادة التعيين.',
  });
  assert.equal(email.sentEmails.length, 1);
  const code = email.sentEmails[0].text.match(
    /رمز إعادة التعيين الخاص بك هو: (\d{6})/,
  )?.[1];
  assert.ok(code);
  assert.equal(email.sentEmails[0].to, 'customer@example.com');
  assert.match(email.sentEmails[0].html, new RegExp(code));
  assert.notEqual(prisma.users[0].passwordResetToken, code);
  assert.equal(
    await bcrypt.compare(code!, prisma.users[0].passwordResetToken),
    true,
  );
  assert.equal(prisma.users[0].passwordResetAttempts, 0);
  assert.ok(
    Math.abs(
      prisma.users[0].passwordResetExpiresAt.getTime() -
        Date.now() -
        60 * 60 * 1000,
    ) < 1_000,
  );
  assert.equal(JSON.stringify(response).includes(code!), false);
});

test('forgot password response is the same when the email is not registered', async () => {
  const { service, prisma, email } = createService();
  prisma.users.push({
    id: 1,
    email: 'customer@example.com',
    passwordHash: 'existing-hash',
    passwordResetAttempts: 0,
  });

  const existing = await service.forgotPassword({
    email: 'customer@example.com',
  });
  const missing = await service.forgotPassword({
    email: 'unknown@example.com',
  });

  assert.deepEqual(existing, missing);
  assert.equal(email.sentEmails.length, 1);
});

test('forgot password logs safe SMTP diagnostics without exposing the code', async () => {
  const { service, prisma, email } = createService();
  const diagnostics: string[] = [];
  Object.defineProperty(service, 'logger', {
    value: { warn: (message: string) => diagnostics.push(message) },
  });
  email.emailError = Object.assign(
    new Error('sensitive recipient, password, and reset token'),
    { code: 'EAUTH', responseCode: 535 },
  );
  prisma.users.push({
    id: 1,
    email: 'customer@example.com',
    passwordHash: 'existing-hash',
    passwordResetAttempts: 0,
  });

  const response = await service.forgotPassword({
    email: 'customer@example.com',
  });

  assert.deepEqual(response, {
    message: 'إن كان هذا البريد مسجّلاً، ستصلك تعليمات إعادة التعيين.',
  });
  assert.deepEqual(JSON.parse(diagnostics[0]), {
    event: 'password_reset_email_failed',
    phase: 'email_delivery',
    errorType: 'Error',
    smtpCode: 535,
  });
  assert.equal(diagnostics[0].includes('customer@example.com'), false);
  assert.equal(diagnostics[0].includes('reset token'), false);
  assert.equal(diagnostics[0].includes('sensitive'), false);
});

test('password reset accepts leading-zero code and consumes it after one use', async () => {
  const { service, prisma } = createService();
  const resetCode = '000042';
  const resetHash = await bcrypt.hash('OldPassword123', 10);
  const resetCodeHash = await bcrypt.hash(resetCode, 10);
  prisma.users.push({
    id: 1,
    email: 'customer@example.com',
    passwordHash: resetHash,
    passwordResetToken: resetCodeHash,
    passwordResetExpiresAt: new Date(Date.now() + 60_000),
    passwordResetAttempts: 0,
  });

  await service.resetPassword({
    email: 'customer@example.com',
    code: resetCode,
    newPassword: 'NewPassword123',
  });
  assert.equal(
    await bcrypt.compare('NewPassword123', prisma.users[0].passwordHash),
    true,
  );
  assert.equal(prisma.users[0].passwordResetToken, null);
  assert.equal(prisma.users[0].passwordResetAttempts, 0);
  await assert.rejects(
    service.resetPassword({
      email: 'customer@example.com',
      code: resetCode,
      newPassword: 'AnotherPassword123',
    }),
    BadRequestException,
  );
});

test('password reset allows the fifth attempt to succeed', async () => {
  const { service, prisma } = createService();
  const correctCode = '000042';
  prisma.users.push({
    id: 1,
    email: 'customer@example.com',
    passwordHash: await bcrypt.hash('OldPassword123', 10),
    passwordResetToken: await bcrypt.hash(correctCode, 10),
    passwordResetExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    passwordResetAttempts: 0,
  });

  for (let attempt = 0; attempt < 4; attempt += 1) {
    await assert.rejects(
      service.resetPassword({
        email: 'customer@example.com',
        code: '999999',
        newPassword: 'NewPassword123',
      }),
      BadRequestException,
    );
  }
  assert.equal(prisma.users[0].passwordResetAttempts, 4);
  await service.resetPassword({
    email: 'customer@example.com',
    code: correctCode,
    newPassword: 'NewPassword123',
  });
  assert.equal(prisma.users[0].passwordResetToken, null);
  await assert.rejects(
    service.resetPassword({
      email: 'customer@example.com',
      code: correctCode,
      newPassword: 'NewPassword123',
    }),
    BadRequestException,
  );
});

test('password reset DTO requires email and exactly six code digits', () => {
  const valid = Object.assign(new ResetPasswordDto(), {
    email: 'customer@example.com',
    code: '000042',
    newPassword: 'NewPassword123',
  });
  const invalid = Object.assign(new ResetPasswordDto(), {
    email: 'customer@example.com',
    code: '12345',
    newPassword: 'NewPassword123',
  });

  assert.deepEqual(validateSync(valid), []);
  assert.ok(validateSync(invalid).some((error) => error.property === 'code'));
});
