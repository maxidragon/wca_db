import { useEffect, useState, useCallback } from "react";
import { Routes, Route, useNavigate, useSearchParams } from "react-router-dom";
import { getToken, getUserInfo, loginWithWca, logout } from "./utils/wcaAuth";
import QueryPage from "./pages/QueryPage";
import { FaGithub } from "react-icons/fa";

const WCA_CLIENT_ID = "CC0A_AtlCDiKhPUqo3Voh1ow-PWfHc_wHnUagPZFjJw";
const WCA_ORIGIN = "https://www.worldcubeassociation.org";

function App() {
  const [searchParams] = useSearchParams();
  const code = searchParams.get("code");
  const navigate = useNavigate();
  const [userInfo, setUserInfo] = useState<any>(getUserInfo());
  const [token, setToken] = useState<string | null>(getToken());

  const handleLoginResponse = useCallback(
    (status: number, data?: any) => {
      if (status === 200) {
        setUserInfo(data.userInfo);
        setToken(data.token);
        navigate("/");
      } else {
        alert(data?.message || "Login failed");
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
  };

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      <header className="bg-white shadow">
        <div className="max-w-6xl mx-auto px-4 py-4 flex justify-between items-center">
          <h1 className="text-2xl font-bold text-blue-600">WCA DB</h1>
          {userInfo ? (
            <div className="flex items-center gap-3">
              {userInfo.avatarUrl && (
                <img
                  src={userInfo.avatarUrl}
                  alt="avatar"
                  className="w-10 h-10 rounded-full border border-gray-300"
                />
              )}
              <span className="font-medium">
                {userInfo.fullName || userInfo.username}
              </span>
              <button
                onClick={handleLogout}
                className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600"
              >
                Logout
              </button>
            </div>
          ) : (
            <button
              onClick={handleWcaLogin}
              className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
            >
              Login with WCA
            </button>
          )}
        </div>
      </header>

      <main className="flex-grow w-full max-w-7xl mx-auto p-4">
      <Routes>
          <Route path="/" element={<QueryPage token={token} />} />
          <Route path="/auth/login" element={<p>Logging in...</p>} />
        </Routes>
      </main>

      <footer className="bg-white shadow-inner">
        <div className="max-w-6xl mx-auto px-4 py-4 flex flex-col items-center justify-center gap-2 text-gray-600 text-sm">
          <a
            href="https://github.com/maxidragon/wca_db"
            target="_blank"
            rel="noopener noreferrer"
            className="text-gray-600 hover:text-gray-800"
          >
            <FaGithub size={40} />
          </a>
          <span className="mt-1 md:mt-0 text-center md:text-left">
            Disclaimer: This tool is for personal use only. Data comes from WCA
            and is used for educational purposes.
          </span>
        </div>
      </footer>
    </div>
  );
}

export default App;
