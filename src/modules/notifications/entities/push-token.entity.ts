import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { User } from '../../users/entities/user.entity';

export enum PushTokenPlatform {
  IOS = 'ios',
  ANDROID = 'android',
}

@Entity('push_tokens')
@Index(['userId'])
@Index(['token'], { unique: true })
export class PushToken extends BaseEntity {
  @Column({ type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Column({ type: 'varchar', unique: true })
  token!: string;

  @Column({ type: 'enum', enum: PushTokenPlatform })
  platform!: PushTokenPlatform;
}
