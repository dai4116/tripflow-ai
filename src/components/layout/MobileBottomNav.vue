<template>
  <nav class="mobile-bottom-nav" aria-label="Mobile navigation">
    <RouterLink :to="{ name: 'dashboard' }">
      <span>▦</span>
      <small>Home</small>
    </RouterLink>
    <RouterLink :to="{ name: 'trip-board' }">
      <span>▤</span>
      <small>Board</small>
    </RouterLink>
    <RouterLink class="mobile-bottom-nav__primary" :to="{ name: 'trip-create' }">
      <span>＋</span>
    </RouterLink>
    <RouterLink :to="{ name: 'landing' }">
      <span>◎</span>
      <small>Explore</small>
    </RouterLink>
  </nav>
</template>
