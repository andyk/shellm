import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("i/:identityId", "routes/identity.tsx"),
  route("i/:identityId/timeline", "routes/timeline.tsx"),
  route("i/:identityId/t/:trajId", "routes/sub-traj.tsx"),
  route("i/:identityId/thinkers", "routes/thinkers.tsx"),
  route("i/:identityId/memories", "routes/memories.tsx"),
] satisfies RouteConfig;
