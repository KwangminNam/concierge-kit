import { login } from './actions';

export default function ActionPage() {
  return (
    <form action={login}>
      <button id="login" type="submit">
        log in
      </button>
    </form>
  );
}
