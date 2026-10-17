export function SectionHead({ id, eyebrow, title, intro }: { id: string; eyebrow: string; title: string; intro?: string }) {
  return (
    <div className="section-head">
      <p className="eyebrow">{eyebrow}</p>
      <h2 id={id} className="display">
        {title}
      </h2>
      {intro && <p className="lead">{intro}</p>}
    </div>
  );
}
