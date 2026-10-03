import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

export enum NafathRequestStatus {
  WAITING = 'WAITING',
  COMPLETED = 'COMPLETED',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED',
  FAILED = 'FAILED',
}

export type NafathStatusSource = 'callback' | 'poll';

@Entity('nafath_requests')
@Index(['nationalId', 'createdAt'])
@Index(['status', 'expiresAt'])
export class NafathRequest {
  /** Also the `requestId` sent to Nafath and returned to the client. */
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 10 })
  nationalId!: string;

  @Column({ type: 'varchar', nullable: true, unique: true })
  transId!: string | null;

  @Column({ type: 'varchar', nullable: true })
  random!: string | null;

  @Column({ type: 'varchar' })
  service!: string;

  @Column({ type: 'varchar', default: NafathRequestStatus.WAITING })
  status!: NafathRequestStatus;

  @Column({ type: 'varchar', nullable: true })
  statusSource!: NafathStatusSource | null;

  /** Verified JWT claims — kept temporarily for sandbox inspection, purged by retention. */
  @Column({ type: 'jsonb', nullable: true })
  claims!: Record<string, unknown> | null;

  @Column({ type: 'varchar' })
  clientIp!: string;

  @Column({ type: 'timestamp' })
  expiresAt!: Date;

  @Column({ type: 'timestamp', nullable: true })
  lastPolledAt!: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  completedAt!: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  consumedAt!: Date | null;

  @Column({ type: 'uuid', nullable: true })
  linkedUserId!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
