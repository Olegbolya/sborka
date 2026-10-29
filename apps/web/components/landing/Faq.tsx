import { FAQ } from '../../lib/landing/content';

export function Faq() {
  return (
    <div className="lp-faq">
      {FAQ.map((item) => (
        <details key={item.q}>
          <summary>{item.q}</summary>
          <p>{item.a}</p>
        </details>
      ))}
    </div>
  );
}
