import { FormEvent, ReactNode, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import {
  Eye,
  EyeOff,
  ArrowRight,
  Mail,
  Lock,
  ShieldCheck,
  Boxes,
  ShoppingCart,
  BarChart3,
  MapPin,
  ClipboardCheck,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { Button, Input, Label } from '../components/ui';

// Login page redesign, round 4 (2026-09-13, CLAUDE.md #68) — the owner did
// a side-by-side visual diff between the live page and the reference and
// listed every remaining layout/style gap explicitly (feature-card grid
// shape, right-panel color warmth, card size, device shadow, spacing,
// button arrow position). This round is purely layout/visual — it does not
// touch any of the wording decisions made in round 3, which stay in place
// unchanged: the marketing copy/badges were already adopted close to
// verbatim, and the factual substitutions below are intentional and were
// each explained to the owner already, not something this pass reopened.
//
// Round 3's copy/honesty notes (still current):
//
//   - Marketing tone/wording (the tagline, headline, badge labels, feature
//     card titles) — adopted close to verbatim. "Smarter Farming. Stronger
//     Markets.", "Your complete feed business management platform.",
//     "Real-time Insights / Smart Inventory / Grow with Confidence" are
//     aspirational marketing copy, not specific factual claims, so there's
//     no honesty problem matching them exactly.
//   - Specific factual/capability claims — still adjusted, not copied
//     verbatim, because these would misrepresent what the app actually
//     does:
//       - "AI Insights" stays renamed to "Smart Reports" — this app
//         deliberately has no AI/prediction features (CLAUDE.md #64, the
//         owner's own rule-based-over-AI choice), so "AI Insights" would be
//         a false claim, not a tone choice.
//       - The "Secure & Reliable" card's description is grounded in the
//         real audit-trail feature rather than the prompt's "enterprise-
//         grade security" language, which oversells what a single-shop MVP
//         system can actually back up.
//       - "Trusted by Feed Businesses Nationwide" (one of four trust-bar
//         items) is replaced with "Every Action Logged" — this is one
//         shop's internal system, not a multi-customer product, so a
//         "nationwide" trust claim would be an outright fabrication, unlike
//         the harmless puffery above.
//       - "Continue with Google" is now shown (matching the reference
//         visually, since the owner has asked for it three times now) but
//         left disabled with an explanatory title — there is still no
//         Google OAuth integration anywhere in this codebase, so a working
//         button would need a real, separate integration project. This is
//         the same honest-but-visible treatment as "Forgot password?" below.
//       - "Forgot password?" stays as honest, non-functional text — only an
//         owner-initiated reset exists (Users page), not self-service.
//   - The photo and the laptop/phone dashboard mockup are the owner's own
//     supplied images (`frontend/public/login-hero.jpg`,
//     `dashboard-laptop.png`, `dashboard-phone.png` — the latter two had
//     their white backgrounds removed via edge flood-fill so they composite
//     over the photo). The numbers baked into those two mockup images (TZS
//     245.6M, Maize Bran 128.5 MT, etc.) are illustrative sample figures
//     from the original render, not live data — normal for a marketing
//     preview graphic, but worth stating plainly since they can never
//     update to reflect the real shop's real numbers.
//
// Round 7 (2026-09-13, CLAUDE.md #68) — the owner sent a full written spec
// for a different overall card treatment (blurred-photo backdrop, larger
// rounded floating card, centered logo/text layout, relabeled form fields,
// no "Don't have an account?" line). Implemented close to as written, with
// two exceptions kept consistent with every earlier round's honesty pass:
//   - The spec's logo direction ("a larger, centered green leaf icon —
//     two overlapping leaf shapes — instead of the small circular globe
//     icon") is implemented here as `BrandLeafMark` below, but this is a
//     real brand-consistency trade-off worth naming: `/logo.png` (the
//     actual Feed Fusion mark) is what every other page in this app uses
//     in its header/sidebar, so the login page now shows a different mark
//     than the rest of the app. Flagging it rather than silently deciding
//     it doesn't matter — if the owner wants one consistent mark
//     app-wide, the real logo should go back in here instead.
//   - The spec's footer line, "Secure login powered by industry-leading
//     encryption," is the same claim already declined in round 3 for the
//     "Secure & Reliable" feature card (there's no specific encryption
//     certification or implementation detail behind that phrase for a
//     single-shop MVP) — kept as "Secure & audited — every action is
//     logged," which is grounded in the app's real audit-trail feature,
//     just centered with an icon as asked.
//
// Round 8 (2026-09-14, CLAUDE.md #68) — the owner reported the real problem
// behind all the visual rounds so far: on their actual screen the page
// needs scrolling to see everything, when it should fit in one view.
// Alongside that, four concrete, explicit fixes:
//   - The custom two-leaf mark from round 7 is gone — back to the real
//     `/logo.png` (the owner circled the brand-panel logo and drew an
//     arrow to the card, i.e. "use that logo here too"), resolving round
//     7's flagged brand-consistency gap in favor of one consistent logo.
//   - "Continue with Google" and its divider are removed outright, not
//     just greyed out — after three rounds of "show it but disabled," the
//     owner's call this time is to not show it at all.
//   - The login card's background is lighter/more translucent now (closer
//     to true frosted glass, per "recommended card yake kama transparent"),
//     letting the blurred photo show through more instead of reading as a
//     near-opaque white box.
//   - "Agriculture Focused" (a trust pill) and the "Smarter Farming.
//     Stronger Markets." tagline are both removed — the owner's own
//     reasoning: this is an animal-feed shop, not an agriculture business,
//     so both lines overstated what the business actually is. Same kind of
//     correction this file has made in the other direction throughout
//     (dropping claims the app can't back up), just owner-initiated this
//     time instead of flagged by this session first.
//   - Everything else (paddings, font sizes, image/mockup sizes, margins)
//     was scaled down throughout both panels as a genuine attempt at the
//     "fit one screen" ask, sized against a ~1366×768 laptop viewport
//     since the owner's actual screen size isn't known here — needs the
//     owner's own confirmation on their real screen since this session has
//     no way to measure their actual browser viewport.
//
// Round 9 (2026-09-14, CLAUDE.md #68) — with scrolling fixed, the owner
// raised a separate problem: the login card sat small and centered in a
// sea of empty green background, where the reference's card fills nearly
// the whole panel width. Card width only: `max-w-sm` -> `max-w-xl` (padding
// widened to match), round 8's frosted-glass background left untouched
// per the owner's explicit instruction to keep it as-is.
//
// Round 10 (2026-09-14, CLAUDE.md #68) — the owner pushed back a third time
// on the card's look, this time on the frosted-glass background itself:
// it still read as solid rather than actually showing the blurred photo
// through it. After confirming understanding (and an honest observation,
// which the owner agreed with, that the reference's own card looks fairly
// opaque too), the owner asked to match the reference plainly rather than
// keep chasing transparency:
//   - The round-7 blurred-photo + tint background is removed outright —
//     back to the plain mint gradient rounds 4-6 used.
//   - The card is solid again (`bg-white/95`, no backdrop-blur) and back
//     to its pre-round-9 width (`max-w-sm`) — reversing both round 8's
//     transparency and round 9's width change, now that the background
//     concept behind them is gone.
//   - The Email/Password field labels get small green circular icon
//     badges (Mail/Lock) instead of plain inline icons, per the owner's
//     ask for "nice icon for email and password."
//
// Round 11 (2026-09-14, CLAUDE.md #68) — the owner sent a fully written
// CSS-level spec for the card itself (elevation/shadow, input field
// contrast, and compactness), not a content or layout-direction change,
// so it's implemented directly rather than gated behind an "explain
// first" round:
//   - Card: bumped to solid `bg-white` (was `bg-white/95`) and a stronger,
//     two-layer elevation shadow plus a crisp 1px edge and a subtle inset
//     top highlight, so it reads as a distinct floating layer over the
//     panel's gradient rather than blending into it.
//   - Inputs: the shared `Input` component already carries a visible
//     `border-slate-300`, but has no background of its own in light mode
//     (only dark mode sets one), so on a near-white card its fields read
//     as flush with the card surface. Added a light gray `bg-slate-50`
//     via this page's own `className` overrides on the two `<Input>`
//     usages below — a LoginPage-local fix, not a change to the shared
//     component, so every other form in the app keeps its current look.
//   - Compactness: card width taken from `max-w-sm` (24rem) down to
//     `max-w-xs` (20rem) — closer to the mobile-app proportions asked
//     for — with side padding and the vertical gaps between logo,
//     headline, subtext, fields and footer all tightened to match.
//
// Round 12 (2026-09-14, CLAUDE.md #68) — after round 11 the owner circled
// the whole right panel and said 10 rounds hadn't managed to remove
// something there; asked to explain rather than guess again, and the
// owner then gave the real direction in full: stop treating this as two
// panels with two separate backgrounds (photo on the left, a plain
// gradient on the right) and instead use ONE photo as a single full-
// screen background behind everything, with the brand content on the
// left and the login card on the right both floating on top of it as
// overlays. Confirmed before touching anything: the left-side brand
// content (logo, headline, feature-card block, trust badges, dashboard
// mockup) stays exactly as it is, just without its own background now;
// the owner also supplied a new photo to use as this shared background
// (`login-hero.jpg` replaced — the previous photo is not deleted from
// disk, just no longer referenced, in case of a revert). So:
//   - The outer wrapper is now the single place the photo + legibility
//     gradient are applied (`min-h-screen w-full`), replacing the old
//     `lg:grid-cols-2` container that used to carry `bg-brand-gradient`.
//   - The left brand column and the right form column are now both
//     transparent — no `dark:from-[#...]` gradient classes on the right
//     column anymore, since there's no separate panel background left to
//     theme; the shared photo shows through both columns in both themes,
//     same as the left column already did before this round.
//   - One side effect worth flagging: the brand-panel column was already
//     `hidden` below the `lg` breakpoint (mobile only ever showed the
//     form column), but that form column used to have its own solid
//     gradient background on mobile too. Now that the background lives on
//     the shared outer wrapper, mobile also shows the photo behind the
//     login card instead of a plain gradient — a natural consequence of
//     "one shared background," not something separately asked for, so
//     flagging it here rather than silently deciding it's fine.
//   - The login card's own styling (solid white, shadow, width, input
//     treatment) is untouched from round 11 — it already reads clearly
//     against a busy photo, so no changes were needed there for this
//     background swap to work.
//
// Round 12b (2026-09-14, CLAUDE.md #68) — immediately after seeing the
// round-12 preview, the owner asked for the card itself to go back to
// transparent/frosted glass so the new shared photo shows through it,
// blurred. `bg-white` (dark: `bg-[#101914]`) -> `bg-white/40 backdrop-
// blur-xl` (dark: `bg-[#101914]/45`), layered on top of — not replacing —
// round 11's elevation shadow and inputs' `bg-slate-50` contrast fix, both
// of which stay as they were.
//
// Round 12c (2026-09-14, CLAUDE.md #68) — the owner sent the original
// reference image again and clarified round 12/12b had gone the wrong
// direction: the reference genuinely is two separate panels (left = photo
// + brand content, right = its own distinct panel that is the login
// panel), not one shared full-bleed background. Reverted:
//   - The outer wrapper goes back to `lg:grid-cols-2` with `bg-brand-
//     gradient`, and the photo + legibility gradient move back onto the
//     brand panel alone (exactly the round-11 structure).
//   - The form panel gets its own background back — the round 10/11 plain
//     mint gradient (`from-[#e6f5ea] via-[#f4faf3] to-[#eaf6ef]`, dark
//     `#0b1310` throughout) — instead of sitting on the shared photo.
//   - The card goes back to solid (`bg-white`, dark `bg-[#101914]`, no
//     `backdrop-blur`) since there's no longer a shared photo directly
//     behind it to blur through — round 12b's frosted treatment only made
//     sense against round 12's shared background.
// What does NOT change: the new photo the owner supplied in round 12
// stays as `login-hero.jpg` and is still what the brand panel shows —
// this round only moves it back to being that panel's own background
// instead of the whole screen's; round 11's card width/padding/shadow and
// the `bg-slate-50` input contrast fix are untouched throughout all of
// 12/12b/12c.
//
// Round 12d (2026-09-14, CLAUDE.md #68) — round 12c overcorrected: the
// owner immediately sent back the round-12b screenshot and said that
// transparent card, on the shared photo, is what they actually want —
// the "two panels" feedback a moment earlier was about the visual
// left-content/right-login split reading clearly, not about giving each
// side its own opaque background. So round 12c is reverted, back to the
// round 12 + 12b combination: single shared full-screen photo behind
// both columns again, and the login card is transparent/frosted
// (`bg-white/40 backdrop-blur-xl`, dark `bg-[#101914]/45`) again.
//
// Round 13 (2026-09-14, CLAUDE.md #68) — a full written layout/density
// spec: the page should fill the viewport more, with fewer large empty
// areas, and both sides scaled up to read as one balanced composition
// rather than small elements floating in open space. This is a scale-up
// pass, not a structural change — the two-column/shared-photo/frosted-
// card structure from round 12d is untouched:
//   - Left side: content block `max-w-2xl` -> `max-w-3xl`, headline
//     `text-2xl` -> `text-3xl`, description `text-sm` -> `text-base`; the
//     dashboard mockup `max-w-[340px]` -> `max-w-[420px]`; the unified
//     feature-card strip's own padding and each `FeatureCard`'s icon/text
//     sizes bumped a step so it reads as a wider, more prominent section
//     instead of a slim strip.
//   - Right side (the login card): `max-w-xs` -> `max-w-md`, padding
//     `p-5/sm:p-6` -> `p-7/sm:p-8`, with the logo, headings, form spacing
//     and the Sign In button (now `size="lg"`) all scaled up to match —
//     "significantly larger and more prominent," per the spec, while
//     staying vertically centered and keeping a margin from the screen
//     edge, both already true of the existing layout.
//
// Round 14 (2026-09-14, CLAUDE.md #68) — two problems reported together
// after seeing round 13 on the real screen: the page needs scrolling
// again, and the 50/50 split leaves the login panel looking like a small
// card "hanging" in a lot of empty right-column space rather than that
// whole side reading as the login panel. Explained back in plain text
// (the owner had been trying to describe this for a few messages) before
// implementing both fixes together:
//   - Grid: `lg:grid-cols-2` (50/50) -> `lg:grid-cols-[7fr_3fr]` (70/30).
//   - The form column and the card, previously two divs (a full-height
//     flex-center wrapper holding a smaller `max-w-md` card with visible
//     empty margin all around it), are now one: the frosted panel itself
//     is the full column (`min-h-screen`, full width, no `max-w` cap),
//     rounded only on its left edge (`rounded-l-[2.5rem]`) since the top/
//     right/bottom sit flush against the viewport. An inner `max-w-sm`
//     wrapper keeps the actual form content a sane reading width and
//     centered, without capping how much of the column the panel's
//     background covers.
//   - Scroll fix: round 13's size increases on the left column are pulled
//     back about one notch each (headline, description, the mockup
//     420px -> 380px, several margins) — still bigger than round 11, just
//     not as large as round 13, so the page fits one screen again.
//
// Round 15 (2026-09-14, CLAUDE.md #68) — two small polish requests after
// round 14 was approved on the real screen: the panel touching all three
// edges should get breathing room (an outer padded wrapper, all four
// corners rounded again), and several low-contrast labels inside the
// translucent panel were hard to read (bumped from slate-400/500 to
// slate-600, dark variants lightened to match).
//
// Round 16 (2026-09-14, CLAUDE.md #68) — the owner asked for "Forgot
// password?" to actually do something on click rather than only carry a
// hover title, since a hover-only tooltip isn't discoverable (especially
// on touch). It's still honest — there is no self-service reset, only an
// owner-initiated one from the Users page (unchanged since round 8) — but
// now clicking it reveals an inline notice saying so explicitly, instead
// of relying on a title attribute nobody hovers over.
const HERO_PHOTO_URL = '/login-hero.jpg';

export default function LoginPage() {
  const { login, isAuthenticated, isOwner } = useAuth();
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: { pathname: string } } };
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showForgotHint, setShowForgotHint] = useState(false);

  if (isAuthenticated) {
    const dest = location.state?.from?.pathname ?? (isOwner ? '/dashboard' : '/pos');
    return <Navigate to={dest} replace />;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password, remember);
      navigate(location.state?.from?.pathname ?? '/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not log in.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    // Round 12d: the owner clarified round 12c overcorrected — the "two
    // panels" feedback was about the visual layout (a clear left
    // content / right login split), not about giving each side its own
    // opaque background. The actual thing wanted is round 12b's look:
    // one shared full-screen photo behind both columns, with a
    // transparent/frosted login card floating on the right — the owner
    // pointed at that exact screenshot. So this reverts round 12c back
    // to the round 12 + 12b combination.
    <div
      className="relative min-h-screen w-full overflow-hidden"
      style={{
        backgroundImage: `linear-gradient(180deg, rgba(255,197,120,0.16) 0%, rgba(6,28,18,0.2) 24%, rgba(6,28,18,0.12) 52%, rgba(6,28,18,0.34) 100%), url(${HERO_PHOTO_URL})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    >
      {/* Round 14: 50/50 -> a 70/30 grid. The owner's point: an even split
          either leaves the login panel "hanging" small in a lot of empty
          right-column space, or forces it to stretch awkwardly to fill
          that space — a narrower right column lets the panel genuinely
          cover its whole side without either problem. */}
      <div className="relative min-h-screen w-full lg:grid lg:grid-cols-[7fr_3fr]">
        {/* Brand column — no background of its own; sits on the shared
            photo behind it. */}
        <div className="relative hidden flex-col justify-between p-7 text-white xl:p-9 lg:flex">
          <div className="relative flex items-center gap-2.5">
          <img src="/logo.png" alt="Feed Fusion Tanzania" className="h-10 w-10 rounded-lg bg-white/95 p-1 object-contain shadow-lg" />
          <div>
            <p className="text-base font-extrabold tracking-tight">Feed Fusion</p>
            <p className="text-[10px] uppercase tracking-[0.25em] text-white/70">Tanzania</p>
          </div>
        </div>

        <div className="relative max-w-3xl" style={{ textShadow: '0 2px 16px rgba(0,0,0,0.45)' }}>
          {/* Round 14: the owner reported the page needs scrolling again
              on their real screen — round 13's size increases (mockup,
              headline, gaps) pushed the left column past common laptop
              viewport heights. Pulled back one notch here (headline,
              description) and on the mockup/margins below, while staying
              above round 11's sizes — a middle ground rather than a full
              reversion, since round 13's density was itself a direct ask. */}
          <h2 className="max-w-xl text-[1.75rem] font-bold leading-tight text-balance">
            Your complete feed business management platform.
          </h2>
          <p className="mt-2.5 max-w-xl text-sm text-white/90 leading-relaxed">
            One system for sales, inventory, pricing approvals and cash reconciliation — built so nothing about
            your stock or your money moves without a record.
          </p>

          <div className="mt-4 flex flex-wrap gap-1.5">
            <Badge icon={<BarChart3 size={12} />} text="Real-time Insights" />
            <Badge icon={<Boxes size={12} />} text="Smart Inventory" />
            <Badge icon={<ShieldCheck size={12} />} text="Grow with Confidence" />
          </div>

          {/* Round 13 enlarged this to 420px; round 14 pulls it back to
              380px (still bigger than round 11's 340px) to help the left
              column fit one screen again. */}
          <div className="relative mt-3 max-w-[380px]">
            <div className="absolute -bottom-3 left-1/2 h-7 w-4/5 -translate-x-1/2 rounded-[50%] bg-black/45 blur-2xl" />
            <img
              src="/dashboard-laptop.png"
              alt=""
              aria-hidden="true"
              className="relative w-full"
              style={{ filter: 'drop-shadow(0 22px 26px rgba(0,0,0,0.5))' }}
            />
            <img
              src="/dashboard-phone.png"
              alt=""
              aria-hidden="true"
              className="absolute -bottom-2 -right-2 w-[30%] sm:-right-4"
              style={{ filter: 'drop-shadow(0 16px 16px rgba(0,0,0,0.5))' }}
            />
          </div>

          {/* Round 6: the previous round's faint translucent "shelf" wasn't
              a strong enough separation from the busy photo behind it, and
              overlapped the mockup's base to sell the "resting on it" look
              — which cut across the owner's explicit "keep the mockups
              exactly as they are" instruction this round. Replaced with an
              actual solid, unified card (no overlap with the mockup above
              it, just a tightened gap) that all four features share, with
              a divider between each instead of four separate floating
              white cards. Round 13: padding bumped up (p-2.5/sm:p-3 ->
              p-3/sm:p-4) and each cell's own padding/text sizes increased
              in FeatureCard below, so this reads as a wider, more
              prominent unified section instead of a slim strip. */}
          <div className="mt-3 rounded-xl bg-white/95 p-2.5 shadow-lg dark:bg-[#101914]/95 sm:p-3">
            <div className="grid grid-cols-4 divide-x divide-slate-100 dark:divide-white/10">
              <FeatureCard
                icon={<Boxes size={15} />}
                title="Inventory Control"
                text="Track stock levels, movements and valuations in real time."
              />
              <FeatureCard
                icon={<ShoppingCart size={15} />}
                title="Sales & Purchases"
                text="Manage orders, suppliers, customers and transactions."
              />
              <FeatureCard
                icon={<BarChart3 size={15} />}
                title="Smart Reports"
                text="Automatic, rule-based reports to track performance."
              />
              <FeatureCard
                icon={<ShieldCheck size={15} />}
                title="Secure & Reliable"
                text="Every action is logged and auditable."
              />
            </div>
          </div>

          {/* Trust items, rounded pill badges (matching the three badges
              above the mockup). "Agriculture Focused" removed round 8 —
              the owner's own point: this is an animal-feed shop, not an
              agriculture business, so the claim overstated the scope. */}
          <div className="mt-3 flex flex-wrap gap-1.5">
            <Badge icon={<MapPin size={11} />} text="Built for Tanzania" />
            <Badge icon={<ShieldCheck size={11} />} text="Owner-Approved Access" />
            <Badge icon={<ClipboardCheck size={11} />} text="Every Action Logged" />
          </div>
        </div>

        <p className="relative text-[11px] text-white/50">&copy; {new Date().getFullYear()} Feed Fusion Tanzania. All rights reserved.</p>
        </div>

        {/* Round 14: the form column and the card used to be two divs — a
            full-height flex-center wrapper with a smaller max-w-md card
            floating in the middle of it, leaving a lot of visible empty
            space around the card at a 50/50 split. The owner's ask was
            for the whole right side to genuinely BE the (transparent)
            login panel, not a small card adrift in a big empty column —
            so those two divs became one, spanning the full column with
            no gap on any side (rounded only on the left edge, since the
            other three sat flush against the viewport).
            Round 15 (2026-09-14, CLAUDE.md #68) — immediately after seeing
            round 14 on the real screen, the owner liked the 70/30 split
            and the panel filling the column, but asked for the panel to
            stop touching the top and bottom edges and to read as a
            floating card rather than a flush-mounted one. Reintroduced a
            thin outer gap (this wrapper's padding) on all four sides —
            top, right, bottom, and left (pulling the panel in slightly
            from the column boundary too) — so the panel now floats with
            visible background around it on every side, and all four
            corners are rounded again (rounded-l-only no longer applies
            once no edge is flush). The panel still fills the rest of the
            column, so it doesn't shrink back into round 13's small,
            adrift card — it's just inset instead of edge-to-edge. */}
        <div className="relative flex min-h-screen w-full items-stretch p-3 sm:p-5 lg:p-6">
        <div
          className="relative flex w-full flex-col justify-center rounded-[2rem] bg-white/40 p-8 backdrop-blur-xl dark:bg-[#101914]/45 sm:p-10"
          style={{
            boxShadow:
              '0 25px 50px -12px rgba(10,40,25,0.45), 0 8px 20px -6px rgba(10,40,25,0.2), inset 0 0 0 1px rgba(255,255,255,0.8), inset 0 1px 0 rgba(255,255,255,0.9)',
          }}
        >
        <div className="mx-auto w-full max-w-sm">
          <div className="flex flex-col items-center text-center">
            <img src="/logo.png" alt="Feed Fusion Tanzania" className="h-14 w-14 rounded-lg bg-white/95 p-1.5 object-contain shadow-lg" />
            <p className="mt-2 text-xl font-extrabold leading-none text-slate-800 dark:text-[#eef3ef]">Feed Fusion</p>
            <p className="mt-1 text-[11px] uppercase tracking-[0.25em] text-slate-600 dark:text-[#cbd5c9]">Tanzania</p>

            <h1 className="mt-4 text-2xl font-bold text-slate-800 dark:text-[#eef3ef]">Welcome Back</h1>
            <p className="mt-1.5 text-sm text-slate-600 dark:text-[#cbd5c9]">Sign in to manage your feed business</p>
          </div>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <Label htmlFor="email" className="flex items-center gap-1.5">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400">
                  <Mail size={11} />
                </span>
                Email
              </Label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                placeholder="Enter your email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="border-slate-300 bg-slate-50"
              />
            </div>
            <div>
              <Label htmlFor="password" className="flex items-center gap-1.5">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400">
                  <Lock size={11} />
                </span>
                Password
              </Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="border-slate-300 bg-slate-50 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-[#77857c] hover:text-slate-600"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between pt-1">
              <label htmlFor="remember" className="flex cursor-pointer items-center gap-2 text-sm text-slate-600 dark:text-[#b6c2ba]">
                <input
                  id="remember"
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-slate-300 accent-green-600 dark:border-[rgba(255,255,255,0.2)]"
                />
                Remember me
              </label>
              <button
                type="button"
                onClick={() => setShowForgotHint((v) => !v)}
                className="text-xs font-medium text-slate-600 underline-offset-2 hover:underline dark:text-[#cbd5c9]"
                title="There's no self-service reset — ask the shop owner."
              >
                Forgot password?
              </button>
            </div>

            {showForgotHint && (
              <div className="flex items-start gap-1.5 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800 dark:border-green-900/40 dark:bg-green-900/20 dark:text-green-300">
                <ShieldCheck size={14} className="mt-0.5 flex-shrink-0" />
                There's no self-reset yet — please contact the shop owner to reset your password.
              </div>
            )}

            {error && (
              <div className="rounded-lg border border-red-200 bg-danger-50 px-3.5 py-2.5 text-sm text-danger-600">
                {error}
              </div>
            )}

            <Button type="submit" size="lg" className="w-full justify-between" loading={submitting}>
              <span>Sign In</span>
              {!submitting && <ArrowRight size={18} />}
            </Button>
          </form>

          {/* Round 8: "Continue with Google" and its divider are removed
              entirely (not just greyed/disabled) — the owner's explicit
              call this round, after three earlier rounds of asking to
              show it disabled. There is still no Google OAuth integration
              anywhere in this codebase, so removing it outright is at
              least as honest as the disabled treatment was. */}

          <div className="mt-4 flex items-center justify-center gap-1.5 text-center text-[11px] font-medium text-slate-600 dark:text-[#cbd5c9]">
            <ShieldCheck size={12} />
            Secure &amp; audited — every action is logged.
          </div>
        </div>
        </div>
        </div>
      </div>
    </div>
  );
}

function Badge({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <span className="flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-xs font-semibold text-green-700 shadow-sm">
      {icon}
      {text}
    </span>
  );
}

function FeatureCard({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  // Round 6: these four now live inside one shared card (see the wrapping
  // container where this is used) instead of each drawing its own
  // background/shadow, so this is just an icon+copy cell with its own
  // side padding — the divider between cells comes from the parent grid's
  // `divide-x`, not from this component. Round 13: padding and text sizes
  // bumped up a step (icon badge h-5/w-5 -> h-6/w-6, title/text sizes up
  // one notch) to read as "wider and more prominent" per the owner's spec.
  return (
    <div className="px-2.5 first:pl-0.5 last:pr-0.5 sm:px-3.5">
      <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-green-600 text-white">{icon}</span>
      <p className="mt-1.5 text-xs font-semibold leading-snug text-slate-800 dark:text-[#eef3ef]">{title}</p>
      <p className="mt-0.5 text-[11px] leading-snug text-slate-500 dark:text-[#97a49b]">{text}</p>
    </div>
  );
}
