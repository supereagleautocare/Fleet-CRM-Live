/**
 * Visit Queue — now just the Route Planner.
 * Queue + Nearby functionality is embedded in the Route Planner itself.
 */
import RouteTab from './RoutePlanner.jsx';

export default function VisitQueue() {
  return (
    <div style={{display:'flex', flexDirection:'column', height:'100%', minHeight:0}}>
      <RouteTab embedded />
    </div>
  );
}
