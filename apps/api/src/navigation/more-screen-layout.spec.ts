import { readFileSync } from 'fs';
import { join } from 'path';

describe('mobile More screen layout contract', () => {
  const moreScreenPath = join(
    __dirname,
    '..',
    '..',
    '..',
    'mobile',
    'src',
    'screens',
    'MoreScreen.tsx',
  );

  it('uses a vertical scroll container with tab-bar-aware bottom spacing', () => {
    const screen = readFileSync(moreScreenPath, 'utf8');

    expect(screen).toContain('import { Pressable, ScrollView');
    expect(screen).toContain('useBottomTabBarHeight');
    expect(screen).toContain('<ScrollView');
    expect(screen).toContain('contentContainerStyle');
    expect(screen).toContain('paddingBottom: tabBarHeight + 24');
    expect(screen).toContain('showsVerticalScrollIndicator={false}');
  });

  it('keeps role-based menu rows and navigation driven by existing destinations', () => {
    const screen = readFileSync(moreScreenPath, 'utf8');

    expect(screen).toContain('getMoreDestinationsForRole(user?.role)');
    expect(screen).toContain('visibleDestinations.map');
    expect(screen).toContain('onPress={() => navigation.navigate(route)}');
    expect(screen).toContain('onPress={() => void logout()}');
  });
});
