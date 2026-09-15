export type UserRole = 'owner' | 'sales' | 'manager';
export type UserStatus = 'active' | 'inactive';

export interface AuthenticatedUser {
  id: number;
  role: UserRole;
}

export interface JwtPayload {
  sub: number;
  role: UserRole;
}

export interface UserRecord {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  password_hash: string;
  role: UserRole;
  status: UserStatus;
  created_at: Date;
  must_change_password: boolean;
  avatar_data_url: string | null;
}

export interface PublicUser {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  role: UserRole;
  status: UserStatus;
  created_at: Date;
  must_change_password: boolean;
  avatar_data_url: string | null;
}

export function toPublicUser(user: UserRecord): PublicUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    status: user.status,
    created_at: user.created_at,
    must_change_password: user.must_change_password,
    avatar_data_url: user.avatar_data_url,
  };
}
