import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

// طبّق هذا الـ Guard على أي Route يتطلب "حسابًا مفعلًا" حسب Business Rules
// (مثال: Event Manager لا يستطيع تبني طلب مناسبة قبل اعتماد حسابه)
@Injectable()
export class ApprovedAccountGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const { user } = context.switchToHttp().getRequest();
    if (!user || user.accountStatus !== 'APPROVED') {
      throw new ForbiddenException(
        'حسابك لا يزال قيد التحقق (Pending Verification). هذه الميزة تتطلب حسابًا مفعّلًا.',
      );
    }
    return true;
  }
}