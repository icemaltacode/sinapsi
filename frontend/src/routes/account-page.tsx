import { useCallback, useEffect, useMemo, useState } from 'react';
import Cropper from 'react-easy-crop';
import type { Area } from 'react-easy-crop';
import { Loader2, Upload } from 'lucide-react';

import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../components/ui/dialog';
import { useAuth } from '../context/auth-context';
import { apiRequest } from '../lib/api';
import { buildAvatarUrl } from '../lib/avatar';

const getAvatarObjectURL = (file: File) => URL.createObjectURL(file);

interface ProfileResponse {
  user: {
    userId: string;
    email: string;
    displayName: string;
    firstName?: string;
    lastName?: string;
    avatarKey?: string | null;
  };
}

async function getCroppedImageBlob(
  file: File,
  areaPixels: Area,
  mimeType = 'image/jpeg'
): Promise<Blob> {
  const image = await createImage(file);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas context missing');
  }

  const size = Math.max(areaPixels.width, areaPixels.height);
  canvas.width = size;
  canvas.height = size;

  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, 2 * Math.PI);
  ctx.closePath();
  ctx.clip();

  ctx.drawImage(
    image,
    areaPixels.x,
    areaPixels.y,
    areaPixels.width,
    areaPixels.height,
    0,
    0,
    size,
    size
  );

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Canvas is empty'));
        return;
      }
      resolve(blob);
    }, mimeType);
  });
}

function createImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (error) => {
      URL.revokeObjectURL(url);
      reject(error);
    };
    img.src = url;
  });
}

export function AccountPage() {
  const { idToken, user, refreshProfile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [displayName, setDisplayName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [avatarKey, setAvatarKey] = useState<string | null | undefined>(null);

  const avatarUrl = useMemo(() => buildAvatarUrl(avatarKey), [avatarKey]);

  const [cropDialogOpen, setCropDialogOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedArea, setCroppedArea] = useState<Area | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const loadProfile = useCallback(async () => {
    if (!idToken) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await apiRequest<ProfileResponse>('/account/profile', {
        token: idToken
      });
      setDisplayName(response.user.displayName);
      setFirstName(response.user.firstName ?? '');
      setLastName(response.user.lastName ?? '');
      setEmail(response.user.email);
      setAvatarKey(response.user.avatarKey ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load profile');
    } finally {
      setLoading(false);
    }
  }, [idToken]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const handleSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!idToken) return;

    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const response = await apiRequest<ProfileResponse>('/account/profile', {
        method: 'PUT',
        token: idToken,
        body: {
          displayName,
          firstName,
          lastName
        }
      });

      setAvatarKey(response.user.avatarKey ?? null);
      setMessage('Profile updated.');
      await refreshProfile();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save profile');
    } finally {
      setSaving(false);
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Please choose an image file.');
      return;
    }
    setSelectedFile(file);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCroppedArea(null);
    setCropDialogOpen(true);
  };

  const handleCropComplete = (_: Area, areaPixels: Area) => {
    setCroppedArea(areaPixels);
  };

  const handleUploadAvatar = async () => {
    if (!idToken || !selectedFile || !croppedArea) return;

    try {
      const croppedBlob = await getCroppedImageBlob(selectedFile, croppedArea, selectedFile.type || 'image/jpeg');
      const response = await apiRequest<{ uploadUrl: string; key: string }>(
        '/account/avatar',
        {
          method: 'POST',
          token: idToken,
          body: { contentType: croppedBlob.type }
        }
      );

      await fetch(response.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': croppedBlob.type },
        body: croppedBlob
      });

      setAvatarKey(response.key);
      setCropDialogOpen(false);
      setSelectedFile(null);
      setPreviewUrl(null);
      await refreshProfile();
      setMessage('Avatar updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to upload avatar');
    }
  };

  useEffect(() => {
    if (!selectedFile) {
      setPreviewUrl(null);
      return;
    }
    const url = getAvatarObjectURL(selectedFile);
    setPreviewUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [selectedFile]);

  if (loading) {
    return (
      <main className='flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top_left,_#232E60,_#0b1120_55%,_#06070d)] text-muted-foreground'>
        <Loader2 className='h-6 w-6 animate-spin' />
      </main>
    );
  }

  return (
    <div className='space-y-6 rounded-2xl border border-border/40 bg-card/70 p-6 shadow-xl backdrop-blur'>
      <header className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
        <div>
          <h1 className='text-2xl font-semibold text-white'>Account settings</h1>
          <p className='text-sm text-muted-foreground'>Update your personal details and avatar.</p>
        </div>
        <div className='flex items-center gap-4'>
          <div className='relative h-20 w-20 cursor-pointer overflow-hidden rounded-full border border-white/30 bg-white/10 shadow-lg' onClick={() => document.getElementById('avatar-upload')?.click()}>
            {avatarUrl ? (
              <img src={avatarUrl} alt='Avatar' className='h-full w-full object-cover' />
            ) : (
              <div className='flex h-full w-full items-center justify-center text-lg font-semibold uppercase text-white/80'>
                {(user?.displayName ?? user?.email ?? 'SU').slice(0, 2)}
              </div>
            )}
            <div className='absolute bottom-0 right-0 flex h-7 w-7 items-center justify-center rounded-full border border-white/40 bg-primary text-primary-foreground shadow-md'>
              <Upload className='h-3.5 w-3.5' />
            </div>
          </div>
          <input
            id='avatar-upload'
            type='file'
            accept='image/*'
            className='hidden'
            onChange={handleFileChange}
          />
        </div>
      </header>

      {message ? <p className='rounded-lg border border-border/50 bg-background/60 px-4 py-3 text-sm text-foreground'>{message}</p> : null}
      {error ? <p className='rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive'>{error}</p> : null}

      <form className='grid gap-4 md:grid-cols-2' onSubmit={handleSave}>
        <div className='grid gap-2 md:col-span-2'>
          <Label htmlFor='displayName'>Display name</Label>
          <Input
            id='displayName'
            required
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </div>
        <div className='grid gap-2'>
          <Label htmlFor='firstName'>First name</Label>
          <Input
            id='firstName'
            value={firstName}
            onChange={(event) => setFirstName(event.target.value)}
          />
        </div>
        <div className='grid gap-2'>
          <Label htmlFor='lastName'>Last name</Label>
          <Input
            id='lastName'
            value={lastName}
            onChange={(event) => setLastName(event.target.value)}
          />
        </div>
        <div className='grid gap-2 md:col-span-2'>
          <Label htmlFor='email'>Email</Label>
          <Input id='email' value={email} disabled className='opacity-70' />
        </div>

        <div className='md:col-span-2 flex justify-end gap-3'>
          <Button type='submit' disabled={saving}>
            {saving ? (
              <>
                <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                Saving…
              </>
            ) : (
              'Save changes'
            )}
          </Button>
        </div>
      </form>

      <Dialog open={cropDialogOpen} onOpenChange={setCropDialogOpen}>
        <DialogContent className='sm:max-w-xl'>
          <DialogHeader>
            <DialogTitle>Crop avatar</DialogTitle>
            <DialogDescription>Adjust the image so it fits nicely inside a circle.</DialogDescription>
          </DialogHeader>
          <div className='relative h-72 w-full overflow-hidden rounded-xl bg-black/70'>
            {selectedFile && previewUrl ? (
              <Cropper
                image={previewUrl}
                crop={crop}
                zoom={zoom}
                aspect={1}
                cropShape='round'
                showGrid={false}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={handleCropComplete}
              />
            ) : null}
          </div>
          <div className='flex items-center gap-4'>
            <label className='text-sm text-muted-foreground'>Zoom</label>
            <input
              type='range'
              min={1}
              max={3}
              step={0.1}
              value={zoom}
              onChange={(event) => setZoom(Number(event.target.value))}
              className='flex-1'
            />
          </div>
          <DialogFooter>
            <Button variant='ghost' onClick={() => setCropDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleUploadAvatar}>Use avatar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
