import { Route, Routes } from 'react-router-dom';
import ConsoleShell from './components/ConsoleShell';
import Landing from './pages/Landing';
import Auth from './pages/Auth';
import Console from './pages/Console';
import ProjectDetail from './pages/ProjectDetail';
import RunDetail from './pages/RunDetail';
import IssueDetail from './pages/IssueDetail';
import Settings from './pages/Settings';
import Placeholder from './pages/Placeholder';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Auth mode="login" />} />
      <Route path="/register" element={<Auth mode="register" />} />
      <Route path="/console" element={<Console />} />
      <Route path="/console/projects/:id" element={<ProjectDetail />} />
      <Route path="/console/runs/:id" element={<RunDetail />} />
      <Route path="/console/issues/:id" element={<IssueDetail />} />
      <Route path="/console/settings" element={<Settings />} />
      <Route
        path="/admin"
        element={
          <ConsoleShell>
            {() => <Placeholder title="管理后台" hint="用户管理、运行监控与模型配置即将上线。" embedded />}
          </ConsoleShell>
        }
      />
    </Routes>
  );
}
