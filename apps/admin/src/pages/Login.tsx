import { FormEvent, useState } from 'react';
import { errorText } from '../api';
import { useAuth } from '../auth';

/** Staff sign-in: password, then the authenticator code; first sign-in enrols the authenticator (2FA is mandatory). */
export function Login() {
  const { login, confirmTotp } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string; setupToken: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (setup) {
        await confirmTotp(setup.setupToken, code);
      } else {
        const res = await login(email, password, code || undefined);
        if ('totpSetup' in res) setSetup(res.totpSetup);
      }
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <form onSubmit={submit} className="card" aria-label="Connexion administrateur">
        <h1>Fitness League · Admin</h1>
        {!setup ? (
          <>
            <label>
              Email
              <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </label>
            <label>
              Mot de passe
              <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </label>
            <label>
              Code d’authentification (si déjà configuré)
              <input inputMode="numeric" pattern="\d{6}" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} />
            </label>
          </>
        ) : (
          <>
            <p>
              La double authentification est obligatoire. Ajoutez ce compte dans votre application (Google Authenticator, Aegis…) avec la clé
              ci-dessous, puis saisissez le code affiché.
            </p>
            <code className="secret" data-testid="totp-secret">
              {setup.secret}
            </code>
            <a href={setup.otpauthUrl}>Ouvrir dans l’application</a>
            <label>
              Code à 6 chiffres
              <input inputMode="numeric" pattern="\d{6}" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} required autoFocus />
            </label>
          </>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button type="submit" disabled={busy}>
          {setup ? 'Activer et se connecter' : 'Se connecter'}
        </button>
      </form>
    </main>
  );
}
