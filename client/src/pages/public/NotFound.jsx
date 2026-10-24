import { LuMapPinOff } from 'react-icons/lu';
import { Link } from '../../lib/router.jsx';
import { EmptyState } from '../../components/ui.jsx';
import { useDocumentTitle } from '../../lib/hooks.js';

export default function NotFound() {
  useDocumentTitle('Page not found');
  return (
    <div className="container page">
      <EmptyState
        icon={LuMapPinOff}
        title="This page does not exist"
        action={
          <Link to="/" className="btn btn--navy">
            Go to the home page
          </Link>
        }
      >
        The link may be old or mistyped.
      </EmptyState>
    </div>
  );
}
