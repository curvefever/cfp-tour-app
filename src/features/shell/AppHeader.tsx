import type { ActiveTab } from '../../domain/tournament/types';
import logoUrl from '../../assets/cfp-logo.svg';
import { cn } from '../../components/ui';
import { AccountMenu } from './AccountMenu';

interface HeaderTab {
  key: ActiveTab;
  label: string;
}

export interface HeaderAccount {
  name: string;
  role: string;
  onSignOut: () => void;
}

const tabClassName =
  'flex cursor-pointer items-center px-3.5 text-[15px] font-semibold whitespace-nowrap text-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary';

function TabButton({
  active,
  onSelect,
  tab,
}: {
  active: boolean;
  onSelect: (tab: ActiveTab) => void;
  tab: HeaderTab;
}) {
  return (
    <button
      aria-current={active ? 'page' : undefined}
      className={cn(
        tabClassName,
        active && 'font-bold text-foreground shadow-[inset_0_-3px_0_var(--app-primary)]',
      )}
      onClick={() => onSelect(tab.key)}
    >
      {tab.label}
    </button>
  );
}

/**
 * The top bar (always the middle look): the logo and "CFP Tournament Hub", the tabs and the signed-in admin. Tournaments stands apart;
 * the loaded tournament's tabs sit together on a lighter band. With no tournament loaded, a divider sets Admin apart.
 */
export function AppHeader({
  account,
  activeTab,
  onHome,
  onSelectTab,
  tabs,
  tournamentLoaded,
}: {
  account: HeaderAccount | null;
  activeTab: ActiveTab;
  onHome: () => void;
  onSelectTab: (tab: ActiveTab) => void;
  tabs: HeaderTab[];
  tournamentLoaded: boolean;
}) {
  const list = tabs.find((tab) => tab.key === 'tournaments');
  const others = tabs.filter((tab) => tab.key !== 'tournaments');
  const buttons = others.map((tab) => (
    <TabButton active={activeTab === tab.key} key={tab.key} onSelect={onSelectTab} tab={tab} />
  ));

  return (
    <header
      className='sticky top-0 z-50 border-b border-cfp-mid-header-border bg-background px-6 max-[700px]:px-3.5'
      data-look='middle'
    >
      <div className='mx-auto flex min-h-15 max-w-310 flex-wrap items-center gap-x-6 gap-y-2'>
        <button
          className='flex cursor-pointer items-center gap-2.5 text-xl font-bold whitespace-nowrap text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'
          onClick={onHome}
        >
          <img alt='' aria-hidden='true' className='h-7 w-auto' height={28} src={logoUrl} width={26} />
          CFP Tournament Hub
        </button>
        <nav
          aria-label='Tournament sections'
          className='flex min-h-15 min-w-0 flex-1 items-stretch overflow-x-auto max-[700px]:order-last max-[700px]:min-h-11 max-[700px]:basis-full'
        >
          {list ? <TabButton active={activeTab === list.key} onSelect={onSelectTab} tab={list} /> : null}
          {tournamentLoaded && others.length > 0 ? (
            <div
              aria-label='This tournament'
              className='ml-5.5 flex items-stretch border-x border-surface-hover bg-surface px-1.5'
              role='group'
            >
              {buttons}
            </div>
          ) : null}
          {!tournamentLoaded && others.length > 0 ? (
            <>
              <div
                aria-hidden='true'
                className='mx-2.5 my-4.5 ml-5.5 w-px self-stretch bg-cfp-mid-header-border'
              />
              {buttons}
            </>
          ) : null}
        </nav>
        <div className='flex items-center gap-3 max-[700px]:ml-auto'>
          {account ? (
            <AccountMenu name={account.name} onSignOut={account.onSignOut} role={account.role} />
          ) : null}
        </div>
      </div>
    </header>
  );
}
