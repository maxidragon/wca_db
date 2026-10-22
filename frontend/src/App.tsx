import { useEffect, useState, useCallback } from "react";
import { Routes, Route, useNavigate, useSearchParams } from "react-router-dom";
import { getToken, getUserInfo, loginWithWca, logout } from "./utils/wcaAuth";
import QueryPage from "./pages/QueryPage/QueryPage";
import RelationsPage from "./pages/RelationsPage/RelationsPage";
import CompetitionsTogetherPage from "./pages/CompetitionsTogetherPage/CompetitionsTogetherPage";
import AchievementsPage from "./pages/AchievementsPage/AchievementsPage";
import BestEverRanksPage from "./pages/BestEverRanksPage/BestEverRanksPage";
import StatisticsPage from "./pages/StatisticsPage/StatisticsPage";
import PersonPage from "./pages/PersonPage/PersonPage";
import NemesesPage from "./pages/NemesesPage/NemesesPage";
import QualificationsPage from "./pages/QualificationsPage/QualificationsPage";
import Navbar, { type NavbarUserInfo } from "./components/Navbar/Navbar";
import { FaGithub } from "react-icons/fa";
import { getMetadata } from "./utils/utils";
import { SESSION_EXPIRED_EVENT } from "./utils/request";
import toast from "react-hot-toast";
import type { ReactNode } from "react";

const WCA_CLIENT_ID = "CC0A_AtlCDiKhPUqo3Voh1ow-PWfHc_wHnUagPZFjJw";
const WCA_ORIGIN = "https://www.worldcubeassociation.org";
// The OAuth redirect_uri is fixed, so the page the user logged in from (with its query string,
// e.g. a shared query link) is kept here and restored once the login completes.
const LOGIN_RETURN_PATH = "loginReturnPath";

interface LoginResponseData {
  userInfo?: NavbarUserInfo;
  token?: string;
  message?: string;
}

function ProtectedPage({
  token,
  onLogin,
  children,
}: {
  token: string | null;
  onLogin: () => void;
  children: ReactNode;
}) {
  if (token) return children;

  return (
    <div className="mx-auto max-w-lg rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm">
      <h2 className="text-2xl font-bold text-gray-900">Login required</h2>
      <p className="mt-2 text-gray-500">
        Log in with your WCA account to use this tool.
      </p>
      <button
        onClick={onLogin}
        className="mt-6 rounded-lg bg-blue-500 px-5 py-2.5 font-medium text-white hover:bg-blue-600 cursor-pointer"
      >
        Login with WCA
      </button>
    </div>
  );
}

function App() {
  const [searchParams] = useSearchParams();
  const code = searchParams.get("code");
  const navigate = useNavigate();
  const [userInfo, setUserInfo] = useState<NavbarUserInfo | null>(getUserInfo());
  const [token, setToken] = useState<string | null>(getToken());
  const [exportDate, setExportDate] = useState<string | null>(null);

  const handleLoginResponse = useCallback(
    (status: number, data?: LoginResponseData) => {
      if (status === 200 && data?.userInfo && data.token) {
        setUserInfo(data.userInfo);
        setToken(data.token);
        const returnPath = sessionStorage.getItem(LOGIN_RETURN_PATH);
        sessionStorage.removeItem(LOGIN_RETURN_PATH);
        navigate(returnPath || "/");
        toast.success("Succesfully logged in");
      } else {
        toast.error(data?.message || "Login failed");
      }
    },
    [navigate]
  );

  const handleCode = useCallback(async () => {
    if (code) {
      const res = await loginWithWca(
        code,
        window.location.origin + "/auth/login"
      );
      handleLoginResponse(res.status, res.data);
    }
  }, [code, handleLoginResponse]);

  useEffect(() => {
    handleCode();
  }, [handleCode]);

  const handleWcaLogin = () => {
    if (window.location.pathname !== "/auth/login") {
      sessionStorage.setItem(
        LOGIN_RETURN_PATH,
        window.location.pathname + window.location.search
      );
    }
    const queryParams = new URLSearchParams({
      redirect_uri: `${window.location.origin}/auth/login`,
      scope: "public",
      response_type: "code",
      client_id: WCA_CLIENT_ID,
    });
    window.location.href = `${WCA_ORIGIN}/oauth/authorize?${queryParams.toString()}`;
  };

  const handleLogout = () => {
    logout();
    setUserInfo(null);
    setToken(null);
    toast.success("Logged out");
  };

  // Several requests usually fail together, so the toast id shows the message once.
  useEffect(() => {
    const endSession = () => {
      setUserInfo(null);
      setToken(null);
      toast.error("Your session has expired. Log in again.", { id: SESSION_EXPIRED_EVENT });
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, endSession);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, endSession);
  }, []);

  useEffect(() => {
    const fetchExportDate = async () => {
      const metadata = await getMetadata();
      if (metadata && metadata.export_timestamp) {
        setExportDate(metadata.export_timestamp);
      } else {
        toast.error("Error fetching metadata");
      }
    };
    fetchExportDate();
  }, []);

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      <Navbar
        userInfo={userInfo}
        onLogin={handleWcaLogin}
        onLogout={handleLogout}
      />

      <main className="flex-grow w-full max-w-7xl mx-auto p-4">
        <Routes>
          <Route path="/" element={(
            <ProtectedPage token={token} onLogin={handleWcaLogin}>
              <QueryPage token={token} />
            </ProtectedPage>
          )} />
          <Route path="/relations" element={(
            <ProtectedPage token={token} onLogin={handleWcaLogin}>
              <RelationsPage />
            </ProtectedPage>
          )} />
          <Route path="/competitions-together" element={(
            <ProtectedPage token={token} onLogin={handleWcaLogin}>
              <CompetitionsTogetherPage />
            </ProtectedPage>
          )} />
          <Route path="/achievements" element={(
            <ProtectedPage token={token} onLogin={handleWcaLogin}>
              <AchievementsPage />
            </ProtectedPage>
          )} />
          <Route path="/best-ever-ranks" element={(
            <ProtectedPage token={token} onLogin={handleWcaLogin}>
              <BestEverRanksPage />
            </ProtectedPage>
          )} />
          <Route path="/person" element={(
            <ProtectedPage token={token} onLogin={handleWcaLogin}>
              <PersonPage />
            </ProtectedPage>
          )} />
          <Route path="/nemeses" element={(
            <ProtectedPage token={token} onLogin={handleWcaLogin}>
              <NemesesPage />
            </ProtectedPage>
          )} />
          <Route path="/qualifications" element={(
            <ProtectedPage token={token} onLogin={handleWcaLogin}>
              <QualificationsPage />
            </ProtectedPage>
          )} />
          <Route path="/statistics" element={(
            <ProtectedPage token={token} onLogin={handleWcaLogin}>
              <StatisticsPage />
            </ProtectedPage>
          )} />
          <Route path="/auth/login" element={<p>Logging in...</p>} />
        </Routes>
      </main>

      <footer className="bg-white shadow-inner">
        <div className="max-w-7xl mx-auto px-4 py-4 flex flex-col items-center justify-center gap-2 text-gray-600 text-sm">
          <a
            href="https://github.com/maxidragon/wca_db"
            target="_blank"
            rel="noopener noreferrer"
            className="text-gray-600 hover:text-gray-800"
          >
            <FaGithub size={40} />
          </a>
          <span className="text-center">
            Results until {new Date(exportDate || "").toLocaleString() || "N/A"}
          </span>
        </div>
      </footer>
    </div>
  );
}

export default App;
