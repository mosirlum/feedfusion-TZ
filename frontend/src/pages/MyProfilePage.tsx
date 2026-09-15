import { ChangeEvent, FormEvent, useState } from 'react';
import { Camera, Eye, EyeOff, KeyRound, Save, UserCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { usersApi, authApi, apiErrorMessage } from '../lib/api';
import { Button, Card, CardHeader, FormField, Input, PageHeader, UserAvatar } from '../components/ui';
import { useToast } from '../components/ui/Toast';
import { isValidTzPhone, sanitizePhoneInput, TZ_PHONE_PLACEHOLDER, TZ_PHONE_HINT, TZ_PHONE_ERROR } from '../lib/phone';

/**
 * My Profile (2026-09-12, CLAUDE.md #47) — self-service name/phone/email/
 * avatar photo, plus a voluntary password change (the same
 * POST /auth/change-password used by the forced first-login flow). The
 * owner explicitly asked for email AND password to be self-editable here
 * ("for now email and password"), so both are included alongside the
 * name/phone/avatar the original request also asked for ("we need to be
 * able to have image profile also").
 *
 * Avatar photos are stored as a base64 `data:` URL (`avatar_data_url`), not
 * an uploaded file — this backend has no file-upload middleware or static
 * file serving, and adding one would need an npm install this session can't
 * run on the owner's machine (CLAUDE.md #47). The photo is resized/
 * compressed client-side via <canvas> before it's ever sent, so a phone
 * photo doesn't bloat the users table with a multi-megabyte string.
 */

const MAX_AVATAR_DIMENSION = 256;

function resizeImageFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that image.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Could not read that image.'));
      img.onload = () => {
        const scale = Math.min(1, MAX_AVATAR_DIMENSION / Math.max(img.width, img.height));
        const width = Math.round(img.width * scale);
        const height = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Could not process that image.'));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

export default function MyProfilePage() {
  const { user, updateUser } = useAuth();
  const toast = useToast();

  const [name, setName] = useState(user?.name ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null | undefined>(undefined);
  const [savingProfile, setSavingProfile] = useState(false);
  const [avatarProcessing, setAvatarProcessing] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

  if (!user) return null;

  async function handleAvatarChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setAvatarProcessing(true);
    try {
      const dataUrl = await resizeImageFile(file);
      setAvatarDataUrl(dataUrl);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not process that image.');
    } finally {
      setAvatarProcessing(false);
    }
  }

  async function handleSaveProfile(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    if (phone.trim() && !isValidTzPhone(phone)) {
      toast.error(TZ_PHONE_ERROR);
      return;
    }
    setSavingProfile(true);
    try {
      const res = await usersApi.updateOwnProfile({
        name: name.trim(),
        phone: phone.trim() || null,
        email: email.trim(),
        ...(avatarDataUrl !== undefined ? { avatarDataUrl } : {}),
      });
      updateUser(res.data);
      setAvatarDataUrl(undefined);
      toast.success('Profile updated.');
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not update your profile.'));
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleChangePassword(e: FormEvent) {
    e.preventDefault();
    if (newPassword.length < 6) {
      toast.error('New password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error('The new password and confirmation do not match.');
      return;
    }
    setChangingPassword(true);
    try {
      const res = await authApi.changePassword(currentPassword, newPassword);
      updateUser(res.data);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      toast.success('Password changed.');
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not change your password.'));
    } finally {
      setChangingPassword(false);
    }
  }

  const previewSrc = avatarDataUrl !== undefined ? avatarDataUrl : user.avatar_data_url;

  return (
    <div className="max-w-2xl">
      <PageHeader title="My Profile" subtitle="Manage your own name, contact details, photo and password." icon={<UserCircle size={20} />} />

      <Card className="mb-6">
        <CardHeader title="Profile details" subtitle="Visible to the owner and, where relevant, other staff." />
        <form onSubmit={handleSaveProfile} className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="relative">
              <UserAvatar name={name || user.name} src={previewSrc} size={64} />
              <label
                className="absolute -bottom-1 -right-1 flex h-6 w-6 cursor-pointer items-center justify-center rounded-full border-2 border-white bg-slate-700 text-white shadow-card hover:bg-slate-800"
                title="Change photo"
              >
                <Camera size={12} />
                <input type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} disabled={avatarProcessing} />
              </label>
            </div>
            <div className="text-sm text-slate-500 dark:text-[#97a49b]">
              <p className="font-medium text-slate-700 dark:text-[#d2dbd5]">{avatarProcessing ? 'Processing photo…' : 'Profile photo'}</p>
              <p className="text-xs text-slate-400 dark:text-[#77857c]">JPG or PNG. Resized automatically.</p>
            </div>
          </div>

          <FormField label="Full name">
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </FormField>
          <FormField label="Email">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </FormField>
          <FormField label="Phone" hint={TZ_PHONE_HINT}>
            <Input
              placeholder={TZ_PHONE_PLACEHOLDER}
              inputMode="numeric"
              value={phone ?? ''}
              onChange={(e) => setPhone(sanitizePhoneInput(e.target.value))}
            />
          </FormField>

          <div className="flex justify-end pt-2">
            <Button type="submit" icon={<Save size={16} />} loading={savingProfile}>
              Save Changes
            </Button>
          </div>
        </form>
      </Card>

      <Card>
        <CardHeader title="Change password" subtitle="Requires your current password." />
        <form onSubmit={handleChangePassword} className="space-y-4">
          <FormField label="Current password">
            <div className="relative">
              <Input
                type={showPasswords ? 'text' : 'password'}
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPasswords((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-[#77857c] hover:text-slate-600"
                tabIndex={-1}
              >
                {showPasswords ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </FormField>
          <FormField label="New password">
            <Input
              type={showPasswords ? 'text' : 'password'}
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={6}
            />
          </FormField>
          <FormField label="Confirm new password">
            <Input
              type={showPasswords ? 'text' : 'password'}
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={6}
            />
          </FormField>
          <div className="flex justify-end pt-2">
            <Button type="submit" variant="secondary" icon={<KeyRound size={16} />} loading={changingPassword}>
              Change Password
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
