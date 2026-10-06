import { FormEvent, useEffect, useState } from 'react';
import { errorText } from '../api';
import { useAuth } from '../auth';
import { useFetch } from '../components/useFetch';

interface Announcement {
  id: string;
  body: string | null;
  imageUrl: string | null;
  createdAt: string;
  likeCount: number;
}

const MAX = 2000;

/** Admins publish news on the app home screen: text and/or one photo (never video); athletes can only like it. */
export function Announcements() {
  const { api } = useAuth();
  const { data, error, reload } = useFetch(() => api.get<{ data: Announcement[] }>('/admin/announcements?limit=50'), [api]);
  const [body, setBody] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  // Local preview of the chosen photo, released when it changes.
  useEffect(() => {
    if (!photo) return setPreview(null);
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  const text = body.trim();
  const canPublish = !busy && (text.length > 0 || photo != null) && text.length <= MAX;

  async function publish(e: FormEvent) {
    e.preventDefault();
    if (!canPublish) return;
    const form = new FormData();
    if (text) form.append('body', text);
    if (photo) form.append('file', photo, photo.name);
    setBusy(true);
    setMessage(null);
    try {
      await api.postForm('/admin/announcements', form);
      setBody('');
      setPhoto(null);
      setMessage({ ok: true, text: 'Publication envoyée aux athlètes.' });
      await reload();
    } catch (err) {
      setMessage({ ok: false, text: errorText(err) });
    } finally {
      setBusy(false);
    }
  }

  async function remove(a: Announcement) {
    if (!window.confirm('Supprimer cette publication ? Elle disparaîtra de l’accueil de l’app.')) return;
    try {
      await api.delete(`/admin/announcements/${a.id}`);
      await reload();
    } catch (err) {
      setMessage({ ok: false, text: errorText(err) });
    }
  }

  return (
    <section>
      <h2>Publications</h2>
      <p className="audit">Affichées dans « Actualités » sur l’accueil de l’app. Les athlètes peuvent aimer, pas commenter. Texte et/ou une photo, jamais de vidéo.</p>
      <form onSubmit={publish} className="card composer" aria-label="Nouvelle publication">
        <label>
          Texte
          <textarea className="prose" rows={4} maxLength={MAX} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Ex. Les inscriptions pour la finale sont ouvertes !" />
        </label>
        <div className="row">
          <span className="audit">{`${text.length} / ${MAX}`}</span>
          <span className="spacer" />
          <label className="file">
            {photo ? 'Changer la photo' : 'Ajouter une photo'}
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
          </label>
          {photo && (
            <button type="button" className="secondary" onClick={() => setPhoto(null)}>
              Retirer la photo
            </button>
          )}
          <button type="submit" disabled={!canPublish}>
            {busy ? 'Publication…' : 'Publier'}
          </button>
        </div>
        {preview && <img className="preview" src={preview} alt="Aperçu de la photo" />}
        {message && (
          <p role={message.ok ? 'status' : 'alert'} className={message.ok ? 'ok' : 'error'}>
            {message.text}
          </p>
        )}
      </form>
      {error != null && <p role="alert">{errorText(error)}</p>}
      <div className="news">
        {data?.data.length === 0 && <p className="audit">Aucune publication pour l’instant.</p>}
        {data?.data.map((a) => (
          <article key={a.id} className="card news-item">
            {a.imageUrl && <img src={a.imageUrl} alt="" />}
            <div className="news-body">
              <span className="audit">{new Date(a.createdAt).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })}</span>
              {a.body && <p>{a.body}</p>}
              <div className="row">
                <strong>{`❤️ ${a.likeCount}`}</strong>
                <span className="spacer" />
                <button type="button" className="danger" onClick={() => remove(a)}>
                  Supprimer
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
