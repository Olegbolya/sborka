import { headers } from 'next/headers';
import { Faq } from '../components/landing/Faq';
import { LazyDemo } from '../components/landing/LazyDemo';
import { PlanCards } from '../components/landing/PlanCards';
import { SitePage } from '../components/landing/SiteChrome';
import { loadPlans } from '../lib/landing/plans';

const POWERS = [
  { title: 'Свои темы', text: 'Цвета, шрифты, фон, переходы и украшения собираются в вашу тему. Один раз оформили — применяете к любой сборке.' },
  { title: 'Свои игры', text: 'Блоки умеют убегать, перетаскиваться, переворачиваться и считать очки. Правила «Когда → Если → Сделать» вы составляете сами.' },
  { title: 'Свои мемы и реакции', text: 'Загружайте собственные картинки и звуки и привязывайте их к ответам: верно, неверно, финал. Чужое — только с правами.' },
];

const STEPS = [
  { n: '1', title: 'Соберите', text: 'Расставьте на экране тексты, фото, кнопки и вопросы. Любое свойство любого блока можно поменять.' },
  { n: '2', title: 'Оживите', text: 'Добавьте правила и поведения: нажатие, перетаскивание, таймер, условия, переменные.' },
  { n: '3', title: 'Поделитесь', text: 'Опубликуйте — получите ссылку и QR-код. Участники проходят сразу, без регистрации.' },
  { n: '4', title: 'Смотрите ответы', text: 'В кабинете — кто и что ответил, итоги и выгрузка.' },
];

export default async function HomePage() {
  const h = await headers();
  const plans = await loadPlans(h.get('x-request-id'));
  return (
    <SitePage>
      <section className="lp-hero">
        <div className="lp-wrap lp-hero-grid">
          <div>
            <p className="lp-kicker">Конструктор интерактивных сборок</p>
            <h1>
              Собери что угодно <span>из блоков</span>
            </h1>
            <p className="lp-lead">
              Открытку, тест, квиз или свою мини-игру. Расставляете блоки на экране, оживляете правилами, делитесь ссылкой или QR-кодом. Участникам регистрироваться не нужно.
            </p>
            <p className="lp-actions">
              <a href="/login" className="lp-btn">
                Собрать бесплатно
              </a>
              <a href="/examples" className="lp-btn lp-btn-ghost">
                Посмотреть примеры
              </a>
            </p>
          </div>
          <div className="lp-hero-demo">
            <p className="lp-demo-cap">Это не картинка. Попробуйте поймать кнопку:</p>
            <LazyDemo demoId="catch" label="Поиграть" />
          </div>
        </div>
      </section>

      <section className="lp-section" aria-labelledby="powers">
        <div className="lp-wrap">
          <h2 id="powers">Собери что угодно — оформи по-своему</h2>
          <ul className="lp-cards">
            {POWERS.map((p) => (
              <li key={p.title}>
                <h3>{p.title}</h3>
                <p>{p.text}</p>
              </li>
            ))}
          </ul>
          <p>
            <a href="/examples">Живые примеры →</a>
          </p>
        </div>
      </section>

      <section className="lp-section lp-alt" aria-labelledby="how">
        <div className="lp-wrap">
          <h2 id="how">Как это работает</h2>
          <ol className="lp-steps">
            {STEPS.map((s) => (
              <li key={s.n}>
                <span className="lp-step-n" aria-hidden="true">
                  {s.n}
                </span>
                <h3>{s.title}</h3>
                <p>{s.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="lp-section" aria-labelledby="plans">
        <div className="lp-wrap">
          <h2 id="plans">Тарифы</h2>
          <p className="lp-lead-small">Начать можно бесплатно. Платите, когда понадобится больше.</p>
          <PlanCards plans={plans} />
          <p>
            <a href="/tariffs">Подробнее о тарифах →</a>
          </p>
        </div>
      </section>

      <section className="lp-section lp-alt" aria-labelledby="faq">
        <div className="lp-wrap lp-narrow">
          <h2 id="faq">Вопросы и ответы</h2>
          <Faq />
        </div>
      </section>
    </SitePage>
  );
}
