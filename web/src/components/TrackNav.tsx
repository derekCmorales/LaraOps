import { Link } from "react-router-dom";
import { moduleBySlug, trackPosition } from "../lib/learning";

/** Al pie de un módulo de una ruta: dónde va en el curso y qué sigue. */
export default function TrackNav({ slug }: { slug: string }) {
  const at = trackPosition(slug);
  if (!at) return null;
  const { track, index } = at;
  const prev = index > 0 ? moduleBySlug(track.steps[index - 1].slug) : undefined;
  const next = index < track.steps.length - 1 ? moduleBySlug(track.steps[index + 1].slug) : undefined;
  const step = track.steps[index];

  return (
    <nav className="track-nav" aria-label={`Ruta ${track.title}`}>
      <div className="track-nav-where">
        <span className="track-nav-label">
          {track.title} · paso {index + 1} de {track.steps.length}
        </span>
        <span className="track-nav-learn">Aquí aprendes: {step.learn.charAt(0).toLowerCase() + step.learn.slice(1)}.</span>
      </div>
      <div className="track-nav-links">
        {prev?.migrated ? (
          <Link to={prev.path} className="btn btn-ghost">
            ← {prev.name}
          </Link>
        ) : null}
        {next?.migrated ? (
          <Link to={next.path} className="btn">
            Siguiente: {next.name} →
          </Link>
        ) : (
          <Link to="/" className="btn btn-ghost">
            Ver las rutas
          </Link>
        )}
      </div>
    </nav>
  );
}
