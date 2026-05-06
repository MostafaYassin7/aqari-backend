import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { MoreThan, Repository } from 'typeorm';
import { UserRole } from '../../common/enums/user-role.enum';
import { User } from '../users/entities/user.entity';
import { CompleteProfileDto } from './dto/complete-profile.dto';
import { OtpCode } from './entities/otp-code.entity';
import { JwtPayload } from './strategies/jwt.strategy';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(OtpCode)
    private readonly otpRepo: Repository<OtpCode>,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  async sendOtp(phone: string): Promise<Record<string, unknown>> {
    // Delete previous unused OTPs for this phone
    await this.otpRepo.delete({ phone, isUsed: false });

    // TODO: replace with real OTP generation before production
    const rawCode = '123456';

    // Hash and save
    const hashed = await bcrypt.hash(rawCode, 10);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    await this.otpRepo.save(
      this.otpRepo.create({ phone, code: hashed, expiresAt }),
    );

    const isDev = this.config.get<string>('NODE_ENV') === 'development';
    console.log(`OTP for ${phone}: ${rawCode}`);

    return {
      message: 'OTP sent',
      ...(isDev && { code: rawCode }),
    };
  }

  async verifyOtp(
    phone: string,
    inputCode: string,
  ): Promise<Record<string, unknown>> {
    const otp = await this.otpRepo.findOne({
      where: { phone, isUsed: false, expiresAt: MoreThan(new Date()) },
      order: { createdAt: 'DESC' },
    });

    if (!otp) throw new UnauthorizedException('OTP expired or not found');

    const isMatch = await bcrypt.compare(inputCode, otp.code);
    if (!isMatch) throw new UnauthorizedException('Invalid OTP code');

    // Mark as used
    otp.isUsed = true;
    await this.otpRepo.save(otp);

    // Find or create user
    let user = await this.usersRepo.findOne({ where: { phone } });
    const isNewUser = !user;

    if (!user) {
      user = await this.usersRepo.save(
        this.usersRepo.create({ phone, role: UserRole.GUEST }),
      );
    }

    const token = this.generateToken(user);
    return { token, isNewUser, ...(isNewUser ? {} : { user: this.sanitize(user) }) };
  }

  async completeProfile(
    userId: string,
    dto: CompleteProfileDto,
  ): Promise<Record<string, unknown>> {
    const user = await this.usersRepo.findOneOrFail({ where: { id: userId } });
    user.name = dto.name;
    user.role = dto.role;
    if (dto.email) user.email = dto.email;
    const updated = await this.usersRepo.save(user);
    const token = this.generateToken(updated);
    return { token, user: this.sanitize(updated) };
  }

  generateToken(user: User): string {
    const payload: JwtPayload = {
      sub: user.id,
      phone: user.phone,
      role: user.role,
    };
    return this.jwtService.sign(payload);
  }

  getMe(user: User): Partial<User> {
    this.usersRepo.update(user.id, { lastActive: new Date() }).catch(() => null);
    return this.sanitize(user);
  }

  sanitize(user: User): Partial<User> {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { deletedAt, ...safe } = user;
    return safe;
  }
}
