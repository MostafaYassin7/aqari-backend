import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { MoreThan, Repository } from 'typeorm';
import { UserRole } from '../../common/enums/user-role.enum';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { User } from '../users/entities/user.entity';
import { CompleteProfileDto } from './dto/complete-profile.dto';
import { OtpCode } from './entities/otp-code.entity';
import { JwtPayload } from './strategies/jwt.strategy';

const TEST_PHONE_OTPS: Record<string, string> = {
  '+201008810487': '123456',
  '+966500000000': '123456',
};

const TEST_ADMIN_PHONES = new Set(['+966500000000']);

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(OtpCode)
    private readonly otpRepo: Repository<OtpCode>,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly whatsapp: WhatsappService,
  ) {}

  async sendOtp(phone: string): Promise<Record<string, unknown>> {
    await this.otpRepo.delete({ phone, isUsed: false });

    const rawCode = TEST_PHONE_OTPS[phone]
      ? TEST_PHONE_OTPS[phone]
      : Math.floor(100000 + Math.random() * 900000).toString();

    const hashed = await bcrypt.hash(rawCode, 10);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    await this.otpRepo.save(
      this.otpRepo.create({ phone, code: hashed, expiresAt }),
    );

    const waPhone = phone.replace(/^\+/, '');
    this.whatsapp
      .sendWhatsappOfficialOtp(waPhone, rawCode)
      .catch((err) => this.logger.error(`WhatsApp OTP delivery failed for ${phone}`, err));

    const isDev = this.config.get<string>('NODE_ENV') === 'development';
    this.logger.log(`OTP requested for ${phone}`);

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
      const role = TEST_ADMIN_PHONES.has(phone) ? UserRole.ADMIN : UserRole.GUEST;
      user = await this.usersRepo.save(this.usersRepo.create({ phone, role }));
    } else if (TEST_ADMIN_PHONES.has(phone) && user.role !== UserRole.ADMIN) {
      user.role = UserRole.ADMIN;
      user = await this.usersRepo.save(user);
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
