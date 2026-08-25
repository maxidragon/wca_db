import { useState } from "react";
import { NavLink } from "react-router-dom";
import { HiMenu, HiX } from "react-icons/hi";

interface NavItem {
  label: string;
  to: string;
}

const NAV_ITEMS: NavItem[] = [
  { label: "Query Tool", to: "/" },
  { label: "Relations", to: "/relations" },
  { label: "Competitions Together", to: "/competitions-together" },
  { label: "Achievements", to: "/achievements" },
  { label: "Best Ever Ranks", to: "/best-ever-ranks" },
];

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

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `px-3 py-2 rounded text-sm font-medium transition-colors ${
      isActive
        ? "bg-blue-100 text-blue-700"
        : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
    }`;

  return (
    <header className="bg-white shadow sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-center justify-between h-14">
          <div className="flex items-center gap-2">
            <NavLink to="/" className="text-xl font-bold text-blue-600 shrink-0">
              WCA DB
            </NavLink>

            {/* Desktop nav */}
            <nav className="hidden md:flex items-center gap-1 ml-4">
              {NAV_ITEMS.map((item) => (
                <NavLink key={item.to} to={item.to} end className={navLinkClass}>
                  {item.label}
                </NavLink>
              ))}
            </nav>
          </div>

          {/* Desktop auth */}
          <div className="hidden md:flex items-center gap-3 shrink-0">
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
            className="md:hidden p-2 rounded text-gray-600 hover:bg-gray-100 cursor-pointer"
            onClick={() => setMenuOpen((o) => !o)}
            aria-label="Toggle menu"
          >
            {menuOpen ? <HiX size={22} /> : <HiMenu size={22} />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <div className="md:hidden border-t border-gray-100 bg-white px-4 pb-4">
          <nav className="flex flex-col gap-1 pt-2">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end
                className={navLinkClass}
                onClick={() => setMenuOpen(false)}
              >
                {item.label}
              </NavLink>
            ))}
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
