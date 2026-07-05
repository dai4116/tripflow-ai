<template>
  <div class="landing-page">
    <section class="landing-hero">
      <div class="landing-hero__copy">
        <StatusBadge>✦ Powered by AI · Now in beta</StatusBadge>
        <h1>Plan trips that flow, powered by AI.</h1>
        <p>
          Describe your dream trip. TripFlow AI builds a Kanban itinerary,
          pins every stop on a map, and adapts as you explore.
        </p>
        <div class="landing-hero__actions">
          <BaseButton :to="{ name: 'trip-create' }">✦ Plan my trip</BaseButton>
          <BaseButton :to="{ name: 'dashboard' }" variant="secondary">View dashboard →</BaseButton>
        </div>
        <div class="landing-hero__trust">
          <span>◎ Free to start</span>
          <span>◎ No credit card</span>
          <span>◎ AI-generated</span>
        </div>
      </div>

      <div class="product-preview" aria-label="TripFlow product preview">
        <div class="product-preview__chrome">
          <span />
          <span />
          <span />
          <strong>app.tripflow.ai/board/tokyo-explorer</strong>
        </div>
        <div class="product-preview__board">
          <div v-for="column in previewColumns" :key="column" class="product-preview__column">
            <strong>{{ column }}</strong>
            <span class="product-preview__mini-card" />
            <span class="product-preview__mini-card" />
            <span class="product-preview__mini-card" />
          </div>
        </div>
        <div class="product-preview__map">
          <div class="product-preview__budget">$3,200 budget<br><span>65% allocated</span></div>
          <span class="map-dot" style="top: 24%; left: 38%" />
          <span class="map-dot" style="top: 48%; left: 62%" />
          <span class="map-dot" style="top: 68%; left: 44%" />
          <span class="map-dot" style="top: 36%; left: 74%" />
          <span class="map-dot" style="top: 77%; left: 58%" />
        </div>
        <BaseCard class="product-preview__toast">
          <strong>Itinerary ready</strong>
          <span>18 places · 7 days</span>
        </BaseCard>
      </div>

      <div class="landing-mobile-preview" aria-label="Trip preview cards">
        <RouterLink
          v-for="trip in previewTrips"
          :key="trip.title"
          class="landing-mobile-trip"
          :to="{ name: 'trip-board' }"
        >
          <span class="landing-mobile-trip__image" :style="{ background: trip.imageGradient }" />
          <strong>{{ trip.title }}</strong>
          <small>⌖ {{ trip.destination }}</small>
          <span class="landing-mobile-trip__progress">
            <i :style="{ width: `${trip.progress}%` }" />
          </span>
        </RouterLink>
      </div>
    </section>

    <section id="features" class="landing-section" aria-label="Features">
      <div class="landing-section__header">
        <h2>Everything you need to travel smarter</h2>
        <p>From inspiration to boarding pass, TripFlow AI handles the heavy lifting.</p>
      </div>

      <div class="section-grid">
        <BaseCard v-for="feature in features" :key="feature.title">
          <StatusBadge tone="accent">{{ feature.label }}</StatusBadge>
          <h3>{{ feature.title }}</h3>
          <p>{{ feature.description }}</p>
        </BaseCard>
      </div>
    </section>

    <section id="workflow" class="landing-section landing-section--white" aria-label="Workflow">
      <div class="landing-section__header">
        <h2>From idea to itinerary in minutes</h2>
      </div>

      <div class="workflow-list">
        <article v-for="step in workflow" :key="step.title" class="workflow-step">
          <strong>{{ step.number }}</strong>
          <div>
            <h3>{{ step.title }}</h3>
            <p>{{ step.description }}</p>
          </div>
        </article>
      </div>
    </section>

    <section class="landing-section" aria-label="Testimonials">
      <div class="testimonial-grid">
        <BaseCard v-for="testimonial in testimonials" :key="testimonial.name" class="testimonial-card">
          <span class="testimonial-card__stars">★★★★★</span>
          <p>“{{ testimonial.quote }}”</p>
          <div>
            <strong>{{ testimonial.name }}</strong>
            <small>{{ testimonial.role }}</small>
          </div>
        </BaseCard>
      </div>
    </section>

    <section class="landing-cta">
      <h2>Ready for your next adventure?</h2>
      <p>Join thousands of travelers who plan smarter with TripFlow AI.</p>
      <BaseButton :to="{ name: 'trip-create' }" variant="accent">Start planning for free</BaseButton>
    </section>

    <footer class="landing-footer">
      <RouterLink class="landing-footer__brand" :to="{ name: 'landing' }">
        <span class="brand-mark">✈</span>
        <strong>TripFlow AI</strong>
      </RouterLink>
      <nav aria-label="Footer navigation">
        <a href="#privacy">Privacy</a>
        <a href="#terms">Terms</a>
        <a href="#contact">Contact</a>
      </nav>
      <small>© 2025 TripFlow AI. All rights reserved.</small>
    </footer>
  </div>
</template>

<script setup lang="ts">
import BaseButton from '../components/ui/BaseButton.vue'
import BaseCard from '../components/ui/BaseCard.vue'
import StatusBadge from '../components/ui/StatusBadge.vue'
import { trips } from '../data/mockTrips'

const previewColumns = ['Planning', 'Day 1', 'Day 2']
const previewTrips = trips.slice(0, 2)

const features = [
  {
    label: '✦',
    title: 'AI Itinerary Generator',
    description: 'Describe your trip in plain language. Our AI builds a complete day-by-day itinerary.',
  },
  {
    label: '▦',
    title: 'Kanban Trip Board',
    description: 'Organize every place, activity, and task with drag-and-drop friendly columns.',
  },
  {
    label: '⌖',
    title: 'Interactive Map View',
    description: 'See every stop plotted on a live map and keep spatial context while planning.',
  },
]

const workflow = [
  {
    number: '01',
    title: 'Describe your trip',
    description: 'Enter destination, dates, budget, travel style, and any preferences or spots to avoid.',
  },
  {
    number: '02',
    title: 'AI generates your plan',
    description: 'TripFlow AI creates a full Kanban board with optimized daily itineraries.',
  },
  {
    number: '03',
    title: 'Explore and refine',
    description: 'Review the map, drag cards to reorder, and customize stops as you travel.',
  },
]

const testimonials = [
  {
    quote: 'I planned my 10-day Japan trip in 20 minutes. The Kanban board made it easy to visualize everything at a glance.',
    name: 'Mia Chen',
    role: 'Solo traveler',
  },
  {
    quote: 'The map and Kanban combo is brilliant. I can see routing and drag cards to optimize each day.',
    name: 'James Okafor',
    role: 'Travel blogger',
  },
  {
    quote: 'Used it for our Santorini honeymoon. The AI suggestions were spot-on and the interface is just beautifully designed.',
    name: 'Sara Lindqvist',
    role: 'Couple traveler',
  },
]
</script>
