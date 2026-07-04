import { Column, Entity, Index, JoinColumn, ManyToOne, OneToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Booking } from '../../bookings/entities/booking.entity';
import { Wallet } from './wallet.entity';

export enum BookingHoldStatus {
  HELD = 'held',
  RELEASED = 'released',
  REFUNDED = 'refunded',
  DISPUTED = 'disputed',
}

@Entity('booking_holds')
@Index(['bookingId'], { unique: true })
@Index(['guestWalletId'])
@Index(['hostWalletId'])
@Index(['status'])
@Index(['releaseAt'])
export class BookingHold extends BaseEntity {
  @Column({ type: 'uuid', unique: true })
  bookingId!: string;

  @OneToOne(() => Booking, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'bookingId' })
  booking!: Booking;

  @Column({ type: 'uuid' })
  guestWalletId!: string;

  @ManyToOne(() => Wallet, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'guestWalletId' })
  guestWallet!: Wallet;

  @Column({ type: 'uuid' })
  hostWalletId!: string;

  @ManyToOne(() => Wallet, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'hostWalletId' })
  hostWallet!: Wallet;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  amount!: string;

  @Column({ type: 'varchar', default: 'SAR' })
  currency!: string;

  @Column({ type: 'enum', enum: BookingHoldStatus, default: BookingHoldStatus.HELD })
  status!: BookingHoldStatus;

  @Column({ type: 'timestamp' })
  releaseAt!: Date;

  @Column({ type: 'timestamp', nullable: true })
  releasedAt!: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  refundedAt!: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  disputedAt!: Date | null;
}
