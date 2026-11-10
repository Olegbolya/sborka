import { LoginView } from './LoginView';

export const metadata = { title: 'Вход — Блоккер' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return <LoginView failed={error === 'oauth'} notConnected={error === 'provider'} blocked={error === 'blocked'} />;
}
