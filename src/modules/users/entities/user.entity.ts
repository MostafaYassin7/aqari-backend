import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { UserRole } from '../../../common/enums/user-role.enum';
import { Establishment } from './establishment.entity';

@Entity('users')
@Index(['phone'])
@Index(['email'])
@Index(['role'])
@Index(['isActive'])
export class User extends BaseEntity {
  @Column({ type: 'varchar', unique: true })
  phone!: string;

  @Column({ type: 'varchar', nullable: true })
  name!: string | null;

  @Column({ type: 'varchar', unique: true, nullable: true })
  email!: string | null;

  @Column({ type: 'varchar', nullable: true })
  profilePhoto!: string | null;

  @Column({ type: 'text', nullable: true })
  bio!: string | null;

  @Column({ type: 'enum', enum: UserRole, default: UserRole.GUEST })
  role!: UserRole;

  @Column({ type: 'boolean', default: false })
  isVerified!: boolean;

  /** National ID / Iqama linked via Nafath. Never selected by default. */
  @Column({ type: 'varchar', length: 10, unique: true, nullable: true, select: false })
  nationalId!: string | null;

  @Column({ type: 'timestamp', nullable: true })
  nafathVerifiedAt!: Date | null;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ type: 'timestamp', nullable: true })
  lastActive!: Date | null;

  @Column({ type: 'uuid', nullable: true })
  establishmentId!: string | null;

  @ManyToOne(() => Establishment, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'establishmentId' })
  establishment!: Establishment | null;
}
