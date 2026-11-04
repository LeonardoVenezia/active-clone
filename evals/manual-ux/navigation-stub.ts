export const useRouter = () => (window as any).qaRouter;
export const usePathname = () => '/new-workflow';
export const useSearchParams = () => new URLSearchParams(window.location.search);
