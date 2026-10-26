import { LoginView } from './LoginView';

export const metadata = { title: 'Вход — Блокум' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return <LoginView failed={error === 'oauth'} />;
}
