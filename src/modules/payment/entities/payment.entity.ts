import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { User } from '../../users/entities/user.entity';

export enum PaymentType {
  TOP_UP = 'top_up',
  RESERVATION = 'reservation',
  PROMOTION = 'promotion',
}

export enum PaymentStatus {
  PENDING = 'pending',
  PAID = 'paid',
  FAILED = 'failed',
  REFUNDED = 'refunded',
}

@Entity('payments')
@Index(['userId'])
@Index(['paymentStatus'])
@Index(['invoiceId'])
export class Payment extends BaseEntity {
  @Column({ type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Column({ type: 'enum', enum: PaymentType })
  type!: PaymentType;

  @Column({ type: 'uuid', nullable: true })
  referenceId!: string | null;

  @Column({ type: 'varchar', nullable: true })
  invoiceId!: string | null;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  invoiceValue!: string;

  @Column({ type: 'varchar', default: 'SAR' })
  displayCurrencyIso!: string;

  @Column({ type: 'enum', enum: PaymentStatus, default: PaymentStatus.PENDING })
  paymentStatus!: PaymentStatus;

  @Column({ type: 'varchar', nullable: true })
  paymentURL!: string | null;

  @Column({ type: 'varchar', nullable: true })
  paymentMethod!: string | null;

  @Column({ type: 'varchar', nullable: true })
  errorMessage!: string | null;
}
