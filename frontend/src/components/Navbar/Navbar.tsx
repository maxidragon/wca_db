import { useEffect, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { HiChevronDown, HiMenu, HiX } from "react-icons/hi";

interface NavItem {
  label: string;
  to: string;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

// Tools about one or two competitors, and tools about one competition, each share a menu, so
// the bar keeps to one line of short labels however many tools there are.
const NAV_ENTRIES: (NavItem | NavGroup)[] = [
  { label: "Query Tool", to: "/" },
  { label: "Statistics", to: "/statistics" },
  {
    label: "Competitors",
    items: [
      { label: "Person", to: "/person" },
      { label: "Nemeses", to: "/nemeses" },
      { label: "Relations", to: "/relations" },
      { label: "Competitions Together", to: "/competitions-together" },
      { label: "Best Ever Ranks", to: "/best-ever-ranks" },
    ],
  },
  {
    label: "Competitions",
    items: [
      { label: "Achievements", to: "/achievements" },
      { label: "Qualifications", to: "/qualifications" },
    ],
  },
];

const isGroup = (entry: NavItem | NavGroup): entry is NavGroup => "items" in entry;

const linkClass = (isActive: boolean) =>
  `whitespace-nowrap px-3 py-2 rounded text-sm font-medium transition-colors ${
    isActive
      ? "bg-blue-100 text-blue-700"
      : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
  }`;

function NavMenu({ group }: { group: NavGroup }) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();
  const active = group.items.some((item) => item.to === pathname);

  // A route change closes the menu, and so does a click outside it or Escape.
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !container.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <div ref={container} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="true"
        className={`${linkClass(active)} flex items-center gap-1 cursor-pointer`}
      >
        {group.label}
        <HiChevronDown className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute left-0 mt-1 min-w-48 rounded-lg border border-gray-200 bg-white p-1 shadow-lg">
          {group.items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end
              className={({ isActive }) => `block ${linkClass(isActive)}`}
            >
              {item.label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

export interface NavbarUserInfo {
  avatarUrl?: string;
  fullName?: string;
  username?: string;
}

interface NavbarProps {
  userInfo: NavbarUserInfo | null;
  onLogin: () => void;
  onLogout: () => void;
}

const Navbar = ({ userInfo, onLogin, onLogout }: NavbarProps) => {
  const [menuOpen, setMenuOpen] = useState(false);

  const navLinkClass = ({ isActive }: { isActive: boolean }) => linkClass(isActive);

  return (
    <header className="bg-white shadow sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-center justify-between h-14">
          <div className="flex items-center gap-2">
            <NavLink to="/" className="text-xl font-bold text-blue-600 shrink-0">
              WCA DB
            </NavLink>

            {/* Desktop nav */}
            <nav className="hidden xl:flex items-center gap-1 ml-4">
              {NAV_ENTRIES.map((entry) =>
                isGroup(entry) ? (
                  <NavMenu key={entry.label} group={entry} />
                ) : (
                  <NavLink key={entry.to} to={entry.to} end className={navLinkClass}>
                    {entry.label}
                  </NavLink>
                )
              )}
            </nav>
          </div>

          {/* Desktop auth */}
          <div className="hidden xl:flex items-center gap-3 shrink-0">
            {userInfo ? (
              <>
                {userInfo.avatarUrl && (
                  <img
                    src={userInfo.avatarUrl}
                    alt="avatar"
                    className="w-8 h-8 rounded-full border border-gray-300"
                  />
                )}
                <span className="text-sm font-medium text-gray-700">
                  {userInfo.fullName || userInfo.username}
                </span>
                <button
                  onClick={onLogout}
                  className="px-3 py-1.5 bg-red-500 text-white text-sm rounded hover:bg-red-600 cursor-pointer"
                >
                  Logout
                </button>
              </>
            ) : (
              <button
                onClick={onLogin}
                className="px-3 py-1.5 bg-blue-500 text-white text-sm rounded hover:bg-blue-600 cursor-pointer"
              >
                Login with WCA
              </button>
            )}
          </div>

          {/* Mobile hamburger */}
          <button
            className="xl:hidden p-2 rounded text-gray-600 hover:bg-gray-100 cursor-pointer"
            onClick={() => setMenuOpen((o) => !o)}
            aria-label="Toggle menu"
            aria-expanded={menuOpen}
          >
            {menuOpen ? <HiX size={22} /> : <HiMenu size={22} />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <div className="xl:hidden border-t border-gray-100 bg-white px-4 pb-4">
          <nav className="flex flex-col gap-1 pt-2">
            {NAV_ENTRIES.map((entry) => {
              const link = (item: NavItem) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end
                  className={navLinkClass}
                  onClick={() => setMenuOpen(false)}
                >
                  {item.label}
                </NavLink>
              );
              if (!isGroup(entry)) return link(entry);
              return (
                <div key={entry.label} className="flex flex-col gap-1">
                  <p className="px-3 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
                    {entry.label}
                  </p>
                  {entry.items.map(link)}
                </div>
              );
            })}
          </nav>
          <div className="mt-3 pt-3 border-t border-gray-100">
            {userInfo ? (
              <div className="flex items-center gap-3">
                {userInfo.avatarUrl && (
                  <img
                    src={userInfo.avatarUrl}
                    alt="avatar"
                    className="w-8 h-8 rounded-full border border-gray-300"
                  />
                )}
                <span className="text-sm font-medium text-gray-700 flex-1">
                  {userInfo.fullName || userInfo.username}
                </span>
                <button
                  onClick={() => { onLogout(); setMenuOpen(false); }}
                  className="px-3 py-1.5 bg-red-500 text-white text-sm rounded hover:bg-red-600 cursor-pointer"
                >
                  Logout
                </button>
              </div>
            ) : (
              <button
                onClick={() => { onLogin(); setMenuOpen(false); }}
                className="w-full px-3 py-2 bg-blue-500 text-white text-sm rounded hover:bg-blue-600 cursor-pointer"
              >
                Login with WCA
              </button>
            )}
          </div>
        </div>
      )}
    </header>
  );
};

export default Navbar;
