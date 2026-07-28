import { useEffect, useState, useCallback } from "react";
import { Routes, Route, useNavigate, useSearchParams } from "react-router-dom";
import { getToken, getUserInfo, loginWithWca, logout } from "./utils/wcaAuth";
import QueryPage from "./pages/QueryPage/QueryPage";
import Navbar from "./components/Navbar/Navbar";
import { FaGithub } from "react-icons/fa";
import { getMetadata } from "./utils/utils";
import toast from "react-hot-toast";

const WCA_CLIENT_ID = "CC0A_AtlCDiKhPUqo3Voh1ow-PWfHc_wHnUagPZFjJw";
const WCA_ORIGIN = "https://www.worldcubeassociation.org";

function App() {
  const [searchParams] = useSearchParams();
  const code = searchParams.get("code");
  const navigate = useNavigate();
  const [userInfo, setUserInfo] = useState<any>(getUserInfo());
  const [token, setToken] = useState<string | null>(getToken());
  const [exportDate, setExportDate] = useState<string | null>(null);

  const handleLoginResponse = useCallback(
    (status: number, data?: any) => {
      if (status === 200) {
        setUserInfo(data.userInfo);
        setToken(data.token);
        navigate("/");
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
          <Route path="/" element={<QueryPage token={token} />} />
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
