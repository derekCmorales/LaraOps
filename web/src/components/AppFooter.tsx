const GITHUB_USER = "derekCmorales";
const GITHUB_URL = `https://github.com/${GITHUB_USER}`;
const GITHUB_AVATAR = "https://avatars.githubusercontent.com/u/158528267?v=4";
const CONTACT_EMAIL = "dacalderonm@correo.url.edu.gt";

export default function AppFooter() {
  return (
    <footer className="app-footer">
      <p className="app-footer-made">
        Hecho con <span className="app-footer-heart">&lt;3</span> por Derek Calderon
      </p>
      <p className="app-footer-contact">
        <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="app-footer-github">
          <img src={GITHUB_AVATAR} alt={`@${GITHUB_USER}`} width={20} height={20} />
          @{GITHUB_USER}
        </a>
        <span className="app-footer-sep" aria-hidden>·</span>
        <span>
          Cualquier cambio, envíamelo a{" "}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
        </span>
      </p>
    </footer>
  );
}
