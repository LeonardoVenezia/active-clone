export const useRouter = () =>
  (
    window as Window & {
      qaRouter?: {
        replace: (url: string) => void;
        push: () => void;
        refresh: () => void;
      };
    }
  ).qaRouter;
export const usePathname = () => "/new-workflow";
export const useSearchParams = () =>
  new URLSearchParams(window.location.search);
